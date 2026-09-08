import { ImageResponse } from 'next/og';

import { OG_IMAGE } from '@/lib/metadata';
import { OG_LAYER_STRIP, OG_PALETTE } from '@/lib/ogPalette';
import { allLessonParams } from '@/modules/learning-center/content/navigation';
import { readyModules } from '@/modules/registry';

/**
 * The card a shared link unfurls into, for every route.
 *
 * One image, at the root, and no per-route variants. Next inherits a file-based
 * `opengraph-image` down the whole segment tree, so this covers the home page, all ten
 * modules, the glossary and every lesson -- and the alternative, forty-odd cards each
 * naming its own page, would mean forty-odd renders per build for a difference nobody
 * reads: the title and description in the unfurl come from each route's `metadata`,
 * which is per-route already. The card's job is to say what product this is.
 *
 * Drawn rather than photographed: it is the same dark surface, the same accent and the
 * same five layer colours the product uses, so a card and the page it opens look like
 * one thing. Colours come from `@/lib/ogPalette` -- Satori cannot resolve a CSS custom
 * property, and that file explains what is done about it.
 *
 * `force-static` because nothing here varies per request. It is rendered once during
 * `next build` and served as a static asset, which also means the image is not a
 * function invocation every time a link is pasted into Slack.
 */

export const dynamic = 'force-static';

/*
 * The three route exports Next reads, all taken from `OG_IMAGE` rather than restated.
 * `pageMetadata` writes the same three values into `og:image:width`, `og:image:height`
 * and `og:image:alt` on every route, and a card whose declared dimensions do not match
 * its pixels is cropped by some consumers and rejected by others.
 */
export const alt = OG_IMAGE.alt;
export const size = { width: OG_IMAGE.width, height: OG_IMAGE.height };
export const contentType = OG_IMAGE.type;

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: OG_PALETTE['--bg-base'],
        // The one flourish: a wash of accent from the top-left, the same gesture the
        // home page's hero uses, so the card reads as the top of that page.
        backgroundImage: `radial-gradient(900px 500px at 8% -10%, ${OG_PALETTE['--bg-raised']} 0%, ${OG_PALETTE['--bg-base']} 70%)`,
        padding: 72,
        fontFamily: 'sans-serif',
      }}
    >
      {/* The wire: five nodes in OSI order, labelled, joined by a link. */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {OG_LAYER_STRIP.map((layer, index) => (
          <div key={layer.short} style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 18px',
                borderRadius: 999,
                border: `2px solid ${layer.hex}`,
                color: layer.hex,
                fontSize: 26,
                letterSpacing: 1,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  backgroundColor: layer.hex,
                }}
              />
              {layer.short}
            </div>
            {index < OG_LAYER_STRIP.length - 1 ? (
              <div
                style={{
                  width: 46,
                  height: 2,
                  backgroundColor: OG_PALETTE['--border'],
                }}
              />
            ) : null}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div
          style={{
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: -2,
            color: OG_PALETTE['--text-primary'],
          }}
        >
          Internet Visualizer
        </div>
        <div
          style={{
            fontSize: 36,
            lineHeight: 1.35,
            color: OG_PALETTE['--text-secondary'],
            maxWidth: 940,
          }}
        >
          {
            'How the Internet works, as live simulations rather than text — DNS, HTTP, TLS, TCP/IP, APIs and WebSockets, packet by packet.'
          }
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${OG_PALETTE['--border']}`,
          paddingTop: 28,
          fontSize: 26,
          color: OG_PALETTE['--text-muted'],
        }}
      >
        {/*
            The same sentence the footer carries on every page. A card that said
            "everything is simulated" would be the one claim the product is careful
            never to make.
          */}
        <div style={{ display: 'flex' }}>
          {`${readyModules().length} modules · deterministic simulations · one opt-in live diagnostics mode`}
        </div>
        <div style={{ display: 'flex', color: OG_PALETTE['--accent'] }}>
          {`${allLessonParams().length} lessons`}
        </div>
      </div>
    </div>,
    size,
  );
}
