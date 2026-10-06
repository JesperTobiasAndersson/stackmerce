// Builds and deploys the current commit to Cloud Run via Cloud Build.
// Tags the image with the short git SHA so revisions are traceable.
//
// The project is pinned here on purpose: `gcloud` uses whatever project is
// active in the local config, and this machine has several. Without --project
// the build runs in the wrong project and fails when pushing the image.
import { execSync } from "node:child_process";

const PROJECT = "discount-494316";

const tag = execSync("git rev-parse --short HEAD").toString().trim();
const command = [
  "gcloud builds submit",
  "--config cloudbuild.yaml",
  `--project=${PROJECT}`,
  `--substitutions=_TAG=${tag}`,
].join(" ");

console.log(command);
execSync(command, { stdio: "inherit", shell: true });
