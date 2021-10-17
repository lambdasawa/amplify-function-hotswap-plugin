const fs = require("fs");
const os = require("os");
const path = require("path");
const watch = require("node-watch");
const archiver = require("archiver");
import { stateManager } from "amplify-cli-core";
const AWS = require("aws-sdk");

const functionDirectoryPath = path.join("amplify", "backend", "function");

async function run(context) {
  context.print.info("Start watch...");
  initAWS();
  startWatch(context);
}

function initAWS() {
  const { envName } = stateManager.getLocalEnvInfo();
  const { profileName } = stateManager.getLocalAWSInfo()[envName];
  AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: profileName });

  const meta = stateManager.getMeta();
  const region = meta["providers"]["awscloudformation"]["Region"];
  AWS.config.region = region;
}

function startWatch(context) {
  watch(functionDirectoryPath, { recursive: true }, (event, name) =>
    onFileChange(context, event, name)
      .then(() => console.log(`Uploaded: ${name}`))
      .catch((e) => console.error(e))
  );
}

async function onFileChange(context, event, name) {
  if (!name.startsWith(functionDirectoryPath)) {
    return;
  }

  await updateLambdaFunction(context, getResourceNameFromPath(name));
}

function getResourceNameFromPath(pathString) {
  return pathString.replace(functionDirectoryPath + path.sep, "").split(path.sep)[0];
}

async function updateLambdaFunction(context, resourceName) {
  const functionName = getFunctionNameFromResourceName(resourceName);

  const zipPath = await createZip(path.join("amplify", "backend", "function", resourceName, "src"));

  const updateFunctionCodeParams = {
    FunctionName: functionName,
    ZipFile: fs.readFileSync(zipPath),
  };

  const lambda = new AWS.Lambda();
  await lambda.updateFunctionCode(updateFunctionCodeParams).promise();
}

function getFunctionNameFromResourceName(resourceName) {
  const meta = stateManager.getMeta();
  const resource = meta["function"][resourceName];
  return resource.output.Arn.match(/arn:aws:lambda:.*:[\d]*:function:([^:]*)/)[1];
}

async function createZip(dir) {
  const tempDirPath = fs.mkdtempSync(os.tmpdir());
  const tempFilePath = path.join(tempDirPath, "function.zip");
  const tempFileStream = fs.createWriteStream(tempFilePath);
  const archive = archiver("zip", {});

  return new Promise((resolve, reject) => {
    tempFileStream.on("close", () => {
      resolve(tempFilePath);
    });

    tempFileStream.on("end", () => {});

    archive.on("warning", reject);

    archive.on("error", reject);

    archive.pipe(tempFileStream);
    archive.directory(dir, false);
    archive.finalize();
  });
}

module.exports = {
  run,
};
