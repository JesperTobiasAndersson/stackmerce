// Builds and deploys the current commit to Cloud Run via Cloud Build.
// Tags the image with the short git SHA so revisions are traceable.
import { execSync } from "node:child_process";

const tag = execSync("git rev-parse --short HEAD").toString().trim();
const command = `gcloud builds submit --config cloudbuild.yaml --substitutions=_TAG=${tag}`;

console.log(command);
execSync(command, { stdio: "inherit", shell: true });
