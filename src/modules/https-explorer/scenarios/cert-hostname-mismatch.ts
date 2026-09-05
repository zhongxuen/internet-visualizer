/**
 * Scenario 5 -- a valid certificate, for somebody else.
 *
 * The second failure, and it breaks step 3 alone. This certificate is impeccable: signed
 * by the trusted intermediate, current, not revoked, correct key usage. It is simply not a
 * certificate for `www.example.com`. Its SAN entries say `example.org` and
 * `www.example.org`, and the client asked for something else.
 *
 * ## The trap is in the subject line
 *
 * The Common Name on this certificate *is* `www.example.com`. A certificate viewer shows
 * it in the headline row, and it looks right. It is not consulted. RFC 9525 s 2 -- which
 * obsoleted RFC 6125 in 2023 and made a decade of browser behaviour normative -- forbids
 * using the subject Common Name to identify a service at all. `checkHostname` never reads
 * it, so this connection fails with a CN that matches perfectly, and the detail line says
 * so, because that is the surprising part.
 *
 * The reason is that CN is a free-text display name with no structure and no way to hold
 * more than one value, so it could not express "this certificate is for these four names"
 * and clients had to guess whether a CN was a hostname at all. SANs are typed, repeatable,
 * and unambiguous.
 *
 * ## What this looks like in the world
 *
 * A shared host answering on an address it serves several sites from, and the SNI routing
 * sent the request to the wrong virtual host -- a misconfiguration, not an attack. It is
 * also precisely what an attacker with a valid certificate for a domain they *do* control
 * produces when they try to answer for one they do not, and the two are indistinguishable
 * from the client's side. That ambiguity is why the check cannot be relaxed.
 */

import type { TlsScenario } from '../sim/connection';

import {
  FIXTURE_ADDRESSES,
  HTTP_REQUEST,
  HTTP_RESPONSE,
  MISMATCH_CHAIN,
  SCENARIO_EPOCH,
  TRUST_STORE,
} from './common';

/** Step 3 fails, and only step 3. `NET::ERR_CERT_COMMON_NAME_INVALID`. */
export const CERT_HOSTNAME_MISMATCH: TlsScenario = {
  id: 'cert-hostname-mismatch',
  title: 'Right certificate, wrong name',
  summary:
    'A genuine, current, trusted certificate presented for a site it was not issued ' +
    'for. Its Common Name says www.example.com and matches; its SAN entries say ' +
    'example.org and do not. Only the SANs count.',
  teaches: [
    'Identity is matched against the subjectAltName list, never the Common Name (RFC 9525 s 2)',
    'A certificate whose CN matches and whose SANs do not still fails -- and the CN is what a viewer shows first',
    'Wildcard rules: one wildcard, as the whole of the leftmost label, covering exactly one label',
    'A shared-host misconfiguration and an attacker holding a certificate for another domain look identical here',
  ],
  version: 'TLS 1.3',
  host: 'www.example.com',
  serverLabel: 'shared host (serving example.org)',
  serverIp: FIXTURE_ADDRESSES.shared,
  chain: MISMATCH_CHAIN,
  store: TRUST_STORE,
  validateAt: SCENARIO_EPOCH,
  suite: 'TLS_AES_128_GCM_SHA256',
  group: 'x25519',
  alpn: 'http/1.1',
  request: HTTP_REQUEST,
  response: HTTP_RESPONSE,
  notes: [
    {
      phase: 'certificate-validation',
      text: 'Read the certificate panel top to bottom. The subject says CN=www.example.com, which is the name that was asked for, and it is completely irrelevant: RFC 9525 s 2 forbids using the Common Name to identify a service. The client compares the requested name against the SAN list -- example.org, www.example.org -- finds no match, and fails. This is the one check where the thing a viewer shows most prominently is the thing that does not count.',
      reference: { rfc: 9525, section: '2', title: 'Service Identity: No CN Fallback' },
    },
    {
      phase: 'certificate-validation',
      text: 'CN was dropped because it could not do the job. It is a free-text display field with no structure, holds one value, and gives a client no way to tell whether the string in it is a hostname or a company name. SANs are typed and repeatable, so a certificate can say "these four DNS names and this IP address" without anyone having to guess. Browsers stopped consulting CN years before RFC 9525 made it normative in 2023.',
      reference: {
        rfc: 9525,
        section: '6.1',
        title: 'Service Identity: Reference Identifiers',
      },
    },
    {
      phase: 'certificate-validation',
      text: 'A wildcard would not have saved this either. RFC 9525 s 6.3 allows at most one wildcard, it must be the entire content of the leftmost label, and it matches exactly one label: *.example.com covers www.example.com but not a.b.example.com and not example.com itself. Nothing in the rules lets a certificate for example.org speak for example.com, however it is written.',
      reference: {
        rfc: 9525,
        section: '6.3',
        title: 'Service Identity: Wildcard Certificates',
      },
    },
    {
      phase: 'abort',
      text: 'bad_certificate(42), fatal, and no page. In the world this is usually a shared host whose SNI routing sent the request to the wrong virtual host -- somebody’s configuration, not an adversary. It is also exactly what an attacker who holds a valid certificate for a domain they do control produces when they answer for one they do not. The client has no way to tell those apart, which is why the check has no soft option.',
      reference: { rfc: 9525, section: '6.6', title: 'Service Identity: Outcome' },
    },
  ],
};
