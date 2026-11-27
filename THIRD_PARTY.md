# Third-party components

MUSICFY's own code is AGPL-3.0-or-later (see `LICENSE`). It calls or, in the Docker image,
distributes the following components. Their licenses are not changed by this repository.

| component | how it is used | license |
|---|---|---|
| **Node.js** | runtime (`node:sqlite`, HTTP) | MIT |
| **Electron** | the macOS app's window and runtime (`MUSICFY.app`) | MIT |
| **ffmpeg-static, @ffprobe-installer** | fetch the standalone ffmpeg and ffprobe placed in the app bundle | MIT wrappers; the binaries they install are GPL (see below) |
| **ffmpeg / ffprobe** | separate executable for probing, transcoding, analysis audio and CDJ export | LGPL-2.1-or-later core; Debian/Homebrew builds enable GPL components, so the binary is usually GPL-2.0-or-later |
| **yt-dlp** | separate executable for downloads | Unlicense (public domain) |
| **Python 3** | analyser interpreter | PSF-2.0 |
| **librosa, numpy, scipy, numba, llvmlite** | analyser venv | BSD/ISC family; each wheel carries its own license in `dist-info` |
| **Debian bookworm packages** | base of the Docker image | mixed DFSG licenses; `/usr/share/doc/<package>/copyright` in the image |

## ffmpeg and the Docker image

MUSICFY invokes `ffmpeg` as a separate process, so the Node code is not a derivative of
it. The Docker image does **distribute** the Debian ffmpeg binary and its libraries. That
distribution keeps ffmpeg's own license and source obligations:

- the image contains `/usr/share/doc/ffmpeg/copyright` and the Debian package metadata;
- corresponding source for Debian bookworm's ffmpeg is available from
  <https://sources.debian.org/src/ffmpeg/> and with `apt-get source ffmpeg` in a bookworm
  environment with `deb-src` enabled;
- if you publish a modified image, keep that copyright file and make the source available
  in the same way.

The Homebrew and distribution packages used outside Docker have their own build options;
check `ffmpeg -version` and the package's copyright file if you redistribute them.

## Catalogue data and artwork

iTunes, Deezer and MusicBrainz are queried live with the operator's own network access.
Cover art is fetched at runtime and is not part of this repository or its npm package.
Their API terms and the rights in the artwork belong to those services and rights holders.

## The macOS app

`MUSICFY.app` distributes, inside `Contents/Resources`:

- the **Electron** runtime (MIT), unmodified apart from the bundle name, icon and
  `Info.plist` of the outer app;
- **ffmpeg** and **ffprobe** from the `ffmpeg-static` and `@ffprobe-installer` packages,
  as separate executables that the Node code invokes;
- **yt-dlp** (`yt-dlp_macos`), as a separate executable.

The ffmpeg builds distributed this way are GPL-2.0-or-later; run `ffmpeg -version` inside
the bundle to see the exact configuration. Their corresponding source is available from
<https://ffmpeg.org/download.html> and from the `ffmpeg-static` release the build pins.
yt-dlp is public domain. The app is ad-hoc signed and not notarized; it makes no claim
about an Apple developer identity.

## Music

No audio is included. The license on this repository does not grant rights to any track,
recording, composition or artwork you add. That is between you, the rights holder and the
service you obtained it from.
