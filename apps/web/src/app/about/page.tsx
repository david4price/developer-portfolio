import type { Metadata } from 'next';
import { profile } from '@portfolio/project-registry';

export const metadata: Metadata = { title: 'About' };

/** Pictographs (e.g. a trailing 🐾) as decoration, so screen readers say the words alone. */
const PICTOGRAPHS = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u;

function DecorativeEmoji({ text }: { text: string }) {
  return text
    .split(PICTOGRAPHS)
    .filter((part) => part !== '')
    .map((part, index) =>
      PICTOGRAPHS.test(part) ? (
        <span key={index} aria-hidden="true">
          {part}
        </span>
      ) : (
        part
      ),
    );
}

export default function AboutPage() {
  const { personal } = profile;
  return (
    <>
      <h1>About</h1>
      {profile.about.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {personal !== undefined && (
        // The owner's interests; a photo gallery can join this section later.
        <section aria-labelledby="personal-heading">
          <h2 id="personal-heading">Beyond the code</h2>
          <p>{personal.intro}</p>
          <ul className="grid">
            {personal.interests.map((interest) => (
              <li key={interest.name} className="ui-card">
                <h3 className="ui-card__title">
                  <DecorativeEmoji text={interest.name} />
                </h3>
                <p>{interest.description}</p>
              </li>
            ))}
          </ul>
          {personal.photos !== undefined && personal.photos.length > 0 && (
            <>
              <h3 id="photos-heading">Photos</h3>
              {/* Prints, no captions: files are in public/photos (-sm shown, -lg opened). */}
              <ul className="photo-grid" aria-labelledby="photos-heading">
                {personal.photos.map((photo) => (
                  <li key={photo.file}>
                    <a className="photo-print" href={`/photos/${photo.file}-lg.webp`}>
                      {/* A plain img on purpose: next/image adds an inline style, which this
                          site's CSP (style-src 'self') blocks, and the files are already
                          resized WebP (images are unoptimized in the static export). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/photos/${photo.file}-sm.webp`}
                        alt={photo.alt}
                        width={photo.width}
                        height={photo.height}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="visually-hidden">(opens the full-size photo)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <ul>
        {profile.links.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </>
  );
}
