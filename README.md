# THINK AGENCY portfolio

A lightweight English portfolio built as a static site for GitHub and Vercel. Each of the 13 top-level folders in `D:\THINK AGENCY` is its own company card. The two Orascom folders remain separate. Media inside a company stays grouped by its original subfolder.

## What's included

- Premium dark editorial design, responsive layout, scroll reveals, and accessible gallery dialogs.
- 13 company folders and a generated catalog of 441 images and 28 videos.
- WebP gallery previews served with the site; high-quality MP4 playback and downloads are transcoded under 100 MB; original photos remain downloadable from R2.
- Cloudflare R2 bucket: `think-agency-portfolio` (created in the connected Cloudflare account).
- The supplied THINK AGENCY logo and confirmed client logos, including HYMA, SGE, Tecnogroup, and VALUE.

The site code does not contain the original media. The original assets remain in `D:\THINK AGENCY`; prepared playback files and compact video downloads live in the ignored `media-upload/` directory.

## Preview locally

From this folder, run `python -m http.server 4173` and open `http://localhost:4173`. The galleries show the optimized images; the configured R2 preview URL serves downloads and video.

## Prepare media again

Install the optional local media tools and run the preparation script from this folder:

```powershell
npm install --prefix tools
npm run --prefix tools prepare-media
```

This reads the source folders without modifying them, rebuilds `data/media-catalog.json` and `media-preview/`, and places compressed playback copies in `media-upload/stream/`.

## Upload originals and playback copies to R2

1. Create an R2 API token scoped to the `think-agency-portfolio` bucket with object read/write access.
2. Copy `tools/.env.example` to `tools/.env.local` and enter the account ID and bucket-scoped S3 credentials there. The secret file is ignored by Git.
3. Run:

```powershell
npm run --prefix tools upload-r2
```

The uploader keeps each company's files under its own bucket prefix, serves original photos as downloads, serves compressed MP4s under 100 MB as both video playback and film downloads, and can resume by skipping objects already in R2. Do not commit `tools/.env.local` or `media-upload/` to GitHub.

The bucket's public `r2.dev` URL is connected for preview. It is rate-limited and intended for development traffic; connect a custom R2 domain for production and replace `mediaBaseUrl` in `site-config.js`.

## Publish with GitHub and Vercel

This repository contains the portfolio site at its root. Import this repository in Vercel, leave **Root Directory** at `./`, select framework preset Other, and leave build and output commands empty. Vercel serves `index.html` and the optimized `media-preview/` files; R2 serves original downloads and playback video.

## Still needed for a public launch

- Connect a production media hostname to R2 and put that URL in `site-config.js`.
- Add the agency's preferred email or WhatsApp/website contact URL to `site-config.js`.
