# HOSG

This repository contains the browser game assets and scripts for HOSG. The project can be run locally with Node.js (see `server.js`) or served statically via GitHub Pages.

## Uploading local changes using the GitHub website
You can move changes made on your machine into GitHub directly from the browser without using the Git CLI. The safest approach is to push changes into a new branch and then open a Pull Request.

1. **Archive the changed files on your machine**
   - Zip only the files you edited (avoid `node_modules/` and other generated assets).
2. **Open your repository on GitHub**
   - Navigate to the repo page and click **Add file ▾ → Upload files**.
3. **Choose a branch**
   - In the upload page, click **Commit changes** and pick **Create a new branch for this commit**.
   - Name it something like `web-upload/<short-description>`.
4. **Upload and commit**
   - Drag your zip or individual files into the upload area (GitHub extracts zips automatically).
   - Add a clear commit message summarizing the change, then commit to the new branch.
5. **Open a Pull Request**
   - After the commit, GitHub will offer to **Compare & pull request**. Click it.
   - Fill in a short description, review the diff, and submit the PR.
6. **Optional: Clean up after merge**
   - Once merged, delete the temporary branch via the PR page or the **Branches** tab.

### Tips
- If you only need to tweak a single file, you can open it on GitHub and click the pencil icon to edit, then commit to a new branch.
- Avoid uploading large dependencies; rely on `package.json` so others can run `npm install`.
- For binary assets, prefer keeping the file sizes small to avoid hitting GitHub’s upload limits.
