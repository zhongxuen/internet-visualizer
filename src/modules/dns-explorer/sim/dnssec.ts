/**
 * DNSSEC -- walking the chain of trust, one zone cut at a time.
 *
 * Plain DNS has no idea who it is talking to. A response is a UDP datagram with a
 * matching transaction id, and anything that can produce one of those can put words in
 * the mouth of any nameserver on the Internet. DNSSEC does not encrypt anything and does
 * not hide anything -- every answer stays public and readable. What it adds is a
 * signature, and a way to decide whether the key that made it is the right key.
 *
 * ## The chain
 *
 * A resolver is configured with exactly one thing it believes without checking: the
 * **root trust anchor** ({@link ROOT_TRUST_ANCHOR}), a DS record for the root zone. From
 * there every step is the same step, repeated down the tree:
 *
 * 1. Fetch the zone's **DNSKEY** RRset, and check it is signed by its own key-signing
 *    key -- a self-signature, which proves nothing on its own.
 * 2. Check that the **DS record the parent published** is the fingerprint of that same
 *    key-signing key. This is the link: the parent, which you already trust, vouching
 *    for the child's key.
 * 3. Check the answer's **RRSIG** against the zone's zone-signing key.
 *
 * Break any link and the chain does not "fall back to plain DNS" -- that is the whole
 * point. Which of three states it lands in is the part worth teaching:
 *
 * - **secure** -- an unbroken chain from the anchor to the answer.
 * - **insecure** -- the chain ends on purpose, at a delegation with no DS record and an
 *   NSEC proving there is none. Most of the Internet is here, and it is not a failure:
 *   an unsigned zone is unsigned, and a validator says so rather than guessing.
 * - **bogus** -- the chain *should* continue and does not: a DS that matches no key, a
 *   signature that does not verify, a signature outside its validity window. A
 *   validating resolver must answer SERVFAIL and hand over nothing (RFC 4035 s5.5).
 *   That is why a DNSSEC misconfiguration takes a domain off the Internet for everyone
 *   using a validating resolver, and leaves it working for everyone else.
 *
 * ## Where the mathematics is supposed to be
 *
 * There is none. {@link signRrset} and {@link dsDigest} in `records.ts` are FNV-1a
 * stand-ins: deterministic, symmetric, and forgeable by anyone who reads this file. What
 * is modelled faithfully is the **structure** -- which key signs what, what the parent
 * actually vouches for, which fields go into the signature (including the original TTL,
 * so a cached record with a counted-down TTL still verifies), and what each kind of
 * failure means. Treat the verdicts here as a teaching model, never as validation.
 */

import type { RfcRef } from '@/core/types/events';

import {
  ROOT,
  ROOT_TRUST_ANCHOR,
  VALIDATION_TIME,
  ancestorsOf,
  displayName,
  dsDigest,
  isInBailiwick,
  keyTagOf,
  labelsOf,
  normalizeName,
  signRrset,
  type DnskeyData,
  type DnsZone,
  type ResourceRecord,
  type RrType,
  type SimulatedInternet,
} from './records';

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** The four states RFC 4033 s5 defines for a validated answer. */
export type DnssecState =
  /** Signed, and every link from the trust anchor holds. */
  | 'secure'
  /** Provably unsigned: a delegation with no DS, and an NSEC saying so. */
  | 'insecure'
  /** Signed and wrong. The resolver must answer SERVFAIL. */
  | 'bogus'
  /** Not enough information to decide -- no trust anchor covers this name. */
  | 'indeterminate';

/** One thing a validator checked, and what it found. */
export interface DnssecCheck {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly reference?: RfcRef;
}

const RFC_4033: RfcRef = {
  rfc: 4033,
  title: 'DNS Security Introduction and Requirements',
};
const RFC_4034: RfcRef = {
  rfc: 4034,
  title: 'Resource Records for the DNS Security Extensions',
};
const RFC_4035: RfcRef = {
  rfc: 4035,
  title: 'Protocol Modifications for the DNS Security Extensions',
};

/** One zone on the way down, with everything the validator learned about it. */
export interface ChainLink {
  /** The zone this link is about. `''` is the root. */
  readonly zone: string;
  /** The zone above it, absent for the root. */
  readonly parent?: string;
  readonly state: DnssecState;
  /** The DS records vouching for this zone -- from the parent, or the trust anchor. */
  readonly ds: readonly ResourceRecord[];
  /** The zone's own DNSKEY RRset. */
  readonly dnskeys: readonly ResourceRecord[];
  /** The key-signing key the DS turned out to match, when it did. */
  readonly ksk?: DnskeyData;
  /** The zone-signing key, which is what actually signs the zone's data. */
  readonly zsk?: DnskeyData;
  readonly checks: readonly DnssecCheck[];
  /** One sentence for the panel, explaining this link's state. */
  readonly reason: string;
}

/** A query a validating resolver had to send that a non-validating one would not. */
export interface DnssecQuery {
  readonly zone: string;
  readonly type: Extract<RrType, 'DNSKEY' | 'DS'>;
  readonly note: string;
}

/** The result of walking the chain and checking the answer against it. */
export interface DnssecValidation {
  readonly state: DnssecState;
  /** Root first, answer zone last. */
  readonly links: readonly ChainLink[];
  /** The extra lookups validation costs, which is most of DNSSEC's overhead. */
  readonly queries: readonly DnssecQuery[];
  /** Whether the answer RRset itself verified. Absent when there was nothing to check. */
  readonly answerVerified?: boolean;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function recordsAt(
  zoneData: DnsZone,
  name: string,
  type: RrType,
): readonly ResourceRecord[] {
  return zoneData.records.filter(
    (record) => record.name === name && record.type === type,
  );
}

function signaturesFor(
  zoneData: DnsZone,
  name: string,
  type: RrType,
): readonly ResourceRecord[] {
  return zoneData.records.filter(
    (record) =>
      record.name === name &&
      record.data.type === 'RRSIG' &&
      record.data.typeCovered === type,
  );
}

/**
 * Check one signature against one key.
 *
 * Every clause here is a real reason a real signature is rejected, in the order
 * RFC 4035 s5.3.1 lists them -- the cheap disqualifiers first, the arithmetic last.
 */
export function verifySignature(
  rrset: readonly ResourceRecord[],
  sig: ResourceRecord,
  key: ResourceRecord,
  at: number = VALIDATION_TIME,
): { ok: boolean; reason: string } {
  if (sig.data.type !== 'RRSIG') return { ok: false, reason: 'not an RRSIG' };
  if (key.data.type !== 'DNSKEY') return { ok: false, reason: 'not a DNSKEY' };
  if (rrset.length === 0) return { ok: false, reason: 'nothing to verify' };

  const rrsig = sig.data;
  const dnskey = key.data;
  const owner = rrset[0].name;

  if (rrsig.algorithm !== dnskey.algorithm) {
    return { ok: false, reason: `algorithm ${rrsig.algorithm} does not match the key` };
  }
  if (rrsig.keyTag !== keyTagOf(dnskey)) {
    return { ok: false, reason: `key tag ${rrsig.keyTag} does not match this key` };
  }
  if (!isInBailiwick(owner, rrsig.signerName)) {
    // A signer may only sign inside its own zone; without this check any signed zone
    // could sign for any name on the Internet.
    return {
      ok: false,
      reason: `${displayName(rrsig.signerName)} may not sign ${displayName(owner)}`,
    };
  }
  if (rrsig.labels > labelsOf(owner).length) {
    return { ok: false, reason: 'label count is longer than the owner name' };
  }
  if (at < rrsig.inception) {
    return { ok: false, reason: 'signature is not valid yet' };
  }
  if (at > rrsig.expiration) {
    // The most common real-world DNSSEC outage: nothing changed, the signatures simply
    // ran out and the resigning job did not run.
    return { ok: false, reason: 'signature has expired' };
  }

  const expected = signRrset(
    dnskey.publicKey,
    owner,
    rrsig.typeCovered,
    rrsig.originalTtl,
    rrset,
  );
  if (expected !== rrsig.signature) {
    return { ok: false, reason: 'signature does not match the RRset' };
  }
  return { ok: true, reason: `verified by key tag ${rrsig.keyTag}` };
}

/** Try every signature against every key; the first pair that works wins. */
export function verifyRrset(
  rrset: readonly ResourceRecord[],
  sigs: readonly ResourceRecord[],
  keys: readonly ResourceRecord[],
  at: number = VALIDATION_TIME,
): { ok: boolean; reason: string; keyTag?: number } {
  if (sigs.length === 0) return { ok: false, reason: 'no RRSIG covering this RRset' };
  if (keys.length === 0) return { ok: false, reason: 'no DNSKEY to check against' };

  // Most keys in a key set fail on the tag, which says nothing interesting. The reason
  // worth reporting comes from the key the signature actually claims to be from.
  let candidateReason: string | undefined;
  let lastReason = 'no signature verified';

  for (const sig of sigs) {
    for (const key of keys) {
      const result = verifySignature(rrset, sig, key, at);
      if (result.ok) {
        return {
          ok: true,
          reason: result.reason,
          ...(sig.data.type === 'RRSIG' ? { keyTag: sig.data.keyTag } : {}),
        };
      }
      if (
        candidateReason === undefined &&
        sig.data.type === 'RRSIG' &&
        key.data.type === 'DNSKEY' &&
        sig.data.keyTag === keyTagOf(key.data)
      ) {
        candidateReason = result.reason;
      }
      lastReason = result.reason;
    }
  }
  return { ok: false, reason: candidateReason ?? lastReason };
}

/** Does this DS record fingerprint this key? */
export function dsMatchesKey(ds: ResourceRecord, key: ResourceRecord): boolean {
  if (ds.data.type !== 'DS' || key.data.type !== 'DNSKEY') return false;
  if (ds.data.keyTag !== keyTagOf(key.data)) return false;
  if (ds.data.algorithm !== key.data.algorithm) return false;
  return ds.data.digest === dsDigest(ds.name, key.data);
}

/** True when an NSEC at a delegation proves the parent published no DS there. */
export function provesNoDs(nsec: ResourceRecord | undefined): boolean {
  return Boolean(nsec && nsec.data.type === 'NSEC' && !nsec.data.types.includes('DS'));
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** What a validation run may be tuned with. */
export interface ValidateOptions {
  /** The one record believed without checking. Defaults to the root anchor. */
  readonly trustAnchor?: ResourceRecord;
  /** Seconds since the epoch to judge signature validity against. */
  readonly at?: number;
}

/** The zone cuts between the root and `name`, shallowest first. */
export function zoneChain(internet: SimulatedInternet, name: string): DnsZone[] {
  const canonical = normalizeName(name);
  const candidates = [canonical, ...ancestorsOf(canonical)].reverse();
  const chain: DnsZone[] = [];
  for (const origin of candidates) {
    const found = internet.byOrigin.get(origin);
    if (found) chain.push(found);
  }
  return chain;
}

function check(
  label: string,
  ok: boolean,
  detail: string,
  reference?: RfcRef,
): DnssecCheck {
  return { label, ok, detail, ...(reference ? { reference } : {}) };
}

/**
 * Walk the chain of trust from the root to whichever zone holds `name`.
 *
 * The walk stops descending the moment it stops being secure. That is not an
 * optimisation: below an insecure delegation there is nothing left to check, and below a
 * bogus one there is nothing left to trust.
 */
export function buildChain(
  internet: SimulatedInternet,
  name: string,
  options: ValidateOptions = {},
): { links: ChainLink[]; queries: DnssecQuery[]; state: DnssecState } {
  const at = options.at ?? VALIDATION_TIME;
  const anchor = options.trustAnchor ?? ROOT_TRUST_ANCHOR;
  const chain = zoneChain(internet, name);
  const links: ChainLink[] = [];
  const queries: DnssecQuery[] = [];

  if (chain.length === 0 || chain[0].origin !== ROOT) {
    return {
      links,
      queries,
      state: 'indeterminate',
    };
  }

  let state: DnssecState = 'secure';

  for (let index = 0; index < chain.length; index += 1) {
    const zoneData = chain[index];
    const parent = index === 0 ? undefined : chain[index - 1];
    const checks: DnssecCheck[] = [];

    // Everything below a link that already stopped being secure inherits its state; a
    // validator does not keep checking signatures it has no reason to believe.
    if (state !== 'secure') {
      links.push({
        zone: zoneData.origin,
        ...(parent ? { parent: parent.origin } : {}),
        state,
        ds: [],
        dnskeys: [],
        checks: [
          check(
            'inherited',
            state === 'insecure',
            `${displayName(zoneData.origin)} sits below a ${state} delegation, so there is nothing here to validate`,
            RFC_4035,
          ),
        ],
        reason: `below a ${state} delegation`,
      });
      continue;
    }

    // 1. What vouches for this zone: the anchor at the root, the parent's DS below it.
    let ds: readonly ResourceRecord[];
    if (!parent) {
      ds = [anchor];
      checks.push(
        check(
          'trust anchor',
          anchor.data.type === 'DS',
          'the root DS is configured into the resolver, not looked up -- a lookup is what it exists to secure',
          RFC_4033,
        ),
      );
    } else {
      queries.push({
        zone: zoneData.origin,
        type: 'DS',
        note: `ask ${displayName(parent.origin)} whether it vouches for ${displayName(zoneData.origin)}`,
      });
      ds = recordsAt(parent, zoneData.origin, 'DS');

      if (ds.length === 0) {
        // No DS. Either the parent proves it published none, in which case the child is
        // genuinely unsigned, or it does not, in which case something removed it.
        const nsec = recordsAt(parent, zoneData.origin, 'NSEC')[0];
        const proven = provesNoDs(nsec);
        checks.push(
          check(
            'DS absent',
            proven,
            proven
              ? `the NSEC at ${displayName(zoneData.origin)} lists the types that exist there and DS is not among them -- provably unsigned`
              : 'no DS and no proof that there should not be one',
            RFC_4035,
          ),
        );
        state = proven ? 'insecure' : 'bogus';
        links.push({
          zone: zoneData.origin,
          parent: parent.origin,
          state,
          ds: [],
          dnskeys: [],
          checks,
          reason: proven
            ? 'unsigned delegation, proven by NSEC -- the chain ends here on purpose'
            : 'no DS and no denial of existence, so the chain is broken rather than ended',
        });
        continue;
      }

      const dsSigs = signaturesFor(parent, zoneData.origin, 'DS');
      const parentKeys = recordsAt(parent, parent.origin, 'DNSKEY');
      const dsVerified = verifyRrset(ds, dsSigs, parentKeys, at);
      checks.push(
        check('DS signed by parent', dsVerified.ok, dsVerified.reason, RFC_4034),
      );
      if (!dsVerified.ok) {
        state = 'bogus';
        links.push({
          zone: zoneData.origin,
          parent: parent.origin,
          state,
          ds,
          dnskeys: [],
          checks,
          reason: `the DS in ${displayName(parent.origin)} did not verify: ${dsVerified.reason}`,
        });
        continue;
      }
    }

    // 2. The zone's own keys, and the self-signature over them.
    queries.push({
      zone: zoneData.origin,
      type: 'DNSKEY',
      note: `fetch the keys ${displayName(zoneData.origin)} signs with`,
    });
    const dnskeys = recordsAt(zoneData, zoneData.origin, 'DNSKEY');
    if (dnskeys.length === 0) {
      // The parent says this zone is signed and it is not. Nothing here can be trusted.
      state = 'bogus';
      checks.push(
        check(
          'DNSKEY present',
          false,
          'the parent published a DS but the zone publishes no keys',
          RFC_4035,
        ),
      );
      links.push({
        zone: zoneData.origin,
        ...(parent ? { parent: parent.origin } : {}),
        state,
        ds,
        dnskeys: [],
        checks,
        reason: 'the parent vouches for a key this zone does not publish',
      });
      continue;
    }

    const keySigs = signaturesFor(zoneData, zoneData.origin, 'DNSKEY');
    const selfSigned = verifyRrset(dnskeys, keySigs, dnskeys, at);
    checks.push(
      check(
        'key set self-signed',
        selfSigned.ok,
        selfSigned.ok
          ? `${selfSigned.reason} -- necessary, but proves nothing on its own`
          : selfSigned.reason,
        RFC_4034,
      ),
    );

    // 3. The link itself: does the DS fingerprint one of these keys?
    const matched = dnskeys.find((key) => ds.some((record) => dsMatchesKey(record, key)));
    checks.push(
      check(
        'DS matches a key',
        Boolean(matched),
        matched
          ? `DS ${ds[0].data.type === 'DS' ? ds[0].data.keyTag : ''} is the fingerprint of this zone's key-signing key`
          : 'the DS matches none of the keys this zone publishes',
        RFC_4034,
      ),
    );

    if (!selfSigned.ok || !matched) {
      state = 'bogus';
      links.push({
        zone: zoneData.origin,
        ...(parent ? { parent: parent.origin } : {}),
        state,
        ds,
        dnskeys,
        checks,
        reason: matched
          ? `the key set of ${displayName(zoneData.origin)} is not correctly self-signed`
          : `nothing in ${displayName(zoneData.origin)} matches the DS its parent published`,
      });
      continue;
    }

    const ksk = matched.data.type === 'DNSKEY' ? matched.data : undefined;
    const zskRecord = dnskeys.find(
      (record) => record.data.type === 'DNSKEY' && record.data.flags === 256,
    );
    const zsk =
      zskRecord && zskRecord.data.type === 'DNSKEY' ? zskRecord.data : undefined;

    links.push({
      zone: zoneData.origin,
      ...(parent ? { parent: parent.origin } : {}),
      state: 'secure',
      ds,
      dnskeys,
      ...(ksk ? { ksk } : {}),
      ...(zsk ? { zsk } : {}),
      checks,
      reason: parent
        ? `${displayName(parent.origin)} vouches for this zone's key-signing key`
        : 'the trust anchor matches the root key-signing key',
    });
  }

  return { links, queries, state };
}

/**
 * Validate one answer: walk the chain, then check the RRset against the zone that
 * signed it.
 *
 * `records` is the answer RRset and `sigs` the RRSIGs that came with it -- the resolver
 * passes what actually arrived, not what the fixture holds, so an answer that lost its
 * signatures on the way fails here exactly as it would in the wild.
 */
export function validateAnswer(
  internet: SimulatedInternet,
  answer: {
    name: string;
    type: RrType;
    records: readonly ResourceRecord[];
    sigs: readonly ResourceRecord[];
  },
  options: ValidateOptions = {},
): DnssecValidation {
  const at = options.at ?? VALIDATION_TIME;
  const { links, queries, state } = buildChain(internet, answer.name, options);

  if (state === 'indeterminate') {
    return {
      state,
      links,
      queries,
      reason: 'no trust anchor covers this name',
    };
  }
  if (state === 'bogus') {
    const broken = links.find((link) => link.state === 'bogus');
    return {
      state,
      links,
      queries,
      answerVerified: false,
      reason: broken
        ? `chain of trust broken at ${displayName(broken.zone)}: ${broken.reason}`
        : 'chain of trust broken',
    };
  }
  if (state === 'insecure') {
    const cut = links.find((link) => link.state === 'insecure');
    return {
      state,
      links,
      queries,
      reason: cut
        ? `${displayName(cut.zone)} is an unsigned delegation, so the answer is unsigned -- which is not the same as wrong`
        : 'the answer is unsigned',
    };
  }

  // Secure chain: the answer itself still has to verify against the zone's keys.
  const signer = links[links.length - 1];
  const zoneData = internet.byOrigin.get(signer.zone);
  const keys = zoneData ? recordsAt(zoneData, zoneData.origin, 'DNSKEY') : [];
  const verified = verifyRrset(answer.records, answer.sigs, keys, at);

  if (!verified.ok) {
    return {
      state: 'bogus',
      links,
      queries,
      answerVerified: false,
      reason: `the answer did not verify: ${verified.reason}`,
    };
  }

  return {
    state: 'secure',
    links,
    queries,
    answerVerified: true,
    reason: `signed by ${displayName(signer.zone)} and vouched for all the way to the root anchor`,
  };
}

/** One line summarising a verdict, for the event log. */
export function describeValidation(validation: DnssecValidation): string {
  return `${validation.state.toUpperCase()}: ${validation.reason}`;
}
