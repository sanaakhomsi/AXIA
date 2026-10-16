<p align="center"><img src="assets/axia-logo.png" alt="AXIA" width="360"></p>

<h3 align="center">Your MRI results, explained.</h3>

<p align="center"><a href="https://axia-lemon.vercel.app"><b>Try AXIA live →</b></a></p>

<p align="center"><b>Prototype</b> · for education only · AXIA does not replace a doctor.</p>

---

AXIA helps people make sense of their own MRI scans. Upload your images, step into an interactive viewing room, and move over the scan to see what each structure is. Add your radiologist's report and AXIA explains it in plain language.

## Features

- **Upload:** PNG, JPEG or uncompressed DICOM files, from a single image to a whole folder. The radiologist's report can come along as PDF, Word or text, or a photo of the printed report; AXIA sorts scans and reports automatically.
- **Viewing room:** a full-screen viewer with a slice strip, zoom and pan, and brightness and contrast controls.
- **Organ caption:** the organ shown in each image, with its medical name and a plain explanation.
- **Hover anatomy:** the name, medical name and tissue type of the structure under the pointer, with an outline of its area.
- **Pinned spots:** a closer look at a chosen spot, plus what your report says about that area.
- **Diagnosis tab:**
  - Without a report: an AI preliminary read of the images.
  - With a report: the radiologist's conclusion explained, side by side with the AI's read.
- **Understand your body:** a lesson for each image, with numbered parts, what each one does, how MRI shows it, a short quiz, and a downloadable, printable study report.
- **Prepare for your appointment:** a printable summary to bring to your doctor, with the report in plain words, the AI's read clearly marked as unverified, the spots you pinned and your questions. It is made on your device; nothing is uploaded.
- **Report explainer:** inside the Diagnosis panel; medical terms in your report defined in plain words, with questions to ask your doctor.

## Deploy it with the AI working (recommended: Vercel)

GitHub Pages only serves static files. The AI needs a small server function that keeps your Claude API key secret, so host the repo on Vercel, which runs the code straight from GitHub.

1. **Get an API key.** Create one in the [Claude Console](https://platform.claude.com/). Set a monthly spend limit there too, because every visitor's request is billed to your account.
2. **Put this repo on GitHub,** as it is.
3. **Import it on Vercel.** On [vercel.com](https://vercel.com/), choose *Add New → Project*, pick this repo, and keep the default settings. There is no build step.
4. **Add your key.** Go to *Project → Settings → Environment Variables*, add `ANTHROPIC_API_KEY` with your key, and redeploy.
5. **Open your site.** Your site is at `https://<project>.vercel.app`. The page finds `api/claude` by itself and switches the AI features on.

Every push to GitHub redeploys automatically.

### Keeping the page on GitHub Pages instead

1. Deploy the repo on Vercel as above, to run the function.
2. On Vercel, add `ALLOWED_ORIGINS=https://<your-username>.github.io`.
3. In `index.html`, uncomment the `window.AXIA_API` line near the top and point it to `https://<project>.vercel.app/api/claude`.
4. Enable GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / root*.

### Without a backend

Opened from GitHub Pages alone or as a local file, AXIA still works without AI: the viewer, zoom, DICOM details, the report glossary and the built-in body-part descriptions. The AI features hide themselves.

## Feedback loop (week 1)

Every AI answer in AXIA has **✓ Right / ✗ Wrong** buttons. Answering "Wrong" asks *"What is it actually?"*. Feedback is only saved if the user ticks the consent box on the welcome page, or allows it when they first give feedback. Each saved verdict is stored with the exact AI answer, the prompt version and who gave it. For spot answers it also stores a small 256 px image crop of that spot. No names, files or report text are ever stored.

### Set up the database (Supabase, about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com/).
2. Open **SQL Editor → New query**, paste the contents of [`supabase/setup.sql`](supabase/setup.sql), and run it. This creates:
   - the `cases` and `feedback` tables, locked so only your server can access them
   - a private `feedback-crops` image bucket
   - two ready-made views, `review_queue` and `accuracy_by_type`
3. In **Project Settings → API**, copy the Project URL and the `service_role` secret.
4. On Vercel, add these environment variables, then redeploy:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLINICIAN_CODE` (a long random code you give to reviewing doctors)

The page finds `api/feedback` by itself. If no database is connected, for example on claude.ai or GitHub Pages alone, feedback is kept for the session only and the page says so.

### Clinician mode

Doctors reviewing AXIA open the **⋯** menu in the top bar and enter the access code. Their verdicts are saved with `reviewer_role = clinician` and `review_status = verified`. A wrong code is refused. Patient feedback starts as `unverified`.

### Reviewing and measuring

- **`review_queue`**, in Supabase's Table Editor, lists unverified feedback, newest first. Mark each row `verified` or `rejected` in the `feedback` table, and add a `reviewer_note` if useful.
- **`accuracy_by_type`** shows the percentage judged correct for each kind of answer and prompt version. Compare verified rows only when judging real accuracy.
- **Image crops** are in **Storage → feedback-crops**, at the path saved in `image_path`.
- **Prompt changes:** when you change a prompt in `index.html`, raise `PROMPT_VERSION` so before-and-after results stay separate.

## How the AI is called

- `api/claude.js` forwards each request to the Claude Messages API.
- Models are set at the top of that file: Claude Haiku 5.5 for quick tasks and Claude Sonnet 5.5 for everything else. You can switch the "complex" tier to Claude Opus 5.5 for the full-scan read; it is slower and costs more.
- The function limits each request to 8 images, rejects oversized inputs, and applies a basic per-visitor rate limit. That rate limit is best effort only; your Console spend limit is the real safety net.
- `vercel.json` allows each request up to 60 seconds. Check your Vercel plan's limit if a full-scan read times out.

## Limitations

- **Not designed for MRI.** Anthropic's documentation states that Claude is not designed to interpret complex diagnostic scans such as CTs or MRIs. AXIA's anatomy labels and AI read are unvalidated and can be wrong.
- **Not a medical device.** AXIA is not certified as a medical device.
- **Compressed DICOM is not decoded yet.** Export those images as PNG.
- **Glossary not reviewed.** The built-in glossary and organ descriptions should be reviewed by a clinician.

## Privacy

Images and reports are processed in the browser. When the AI runs, the images and report text needed for each request pass through your function to the Claude API. Nothing is stored by AXIA itself. Before handling real patient data, check your obligations under health-data rules such as GDPR.

## Credits

**Sample images.** The "Explore a sample" brain MRI uses slices of the MNI ICBM152 non-linear symmetric 2009a template, as bundled with [nilearn](https://nilearn.github.io/). Copyright (C) 1993–2004 Louis Collins, McConnell Brain Imaging Centre, Montreal Neurological Institute, McGill University. Permission to use, copy, modify and distribute is granted provided this copyright notice appears in all copies ([source](https://nist.mni.mcgill.ca/icbm-152-nonlinear-atlases-2009/)). Please cite: Fonov et al., *NeuroImage* 54(1), 2011 (doi:10.1016/j.neuroimage.2010.07.033) and Fonov et al., *NeuroImage* 47(S1), 2009 (doi:10.1016/S1053-8119(09)70884-5). The tissue labels were derived by AXIA from the template's grey and white matter probability maps and are approximate.


DICOM parsing by [dicom-parser](https://github.com/cornerstonejs/dicomParser), PDF reading by [PDF.js](https://mozilla.github.io/pdf.js/) and Word reading by [mammoth](https://github.com/mwilliamson/mammoth.js), all loaded from jsDelivr. Fonts: Figtree and IBM Plex Mono from Google Fonts.

## License

The code is released under the [MIT License](LICENSE). The sample MRI data, the AXIA name and logo, and the background video keep their own terms; see [LICENSE](LICENSE).
