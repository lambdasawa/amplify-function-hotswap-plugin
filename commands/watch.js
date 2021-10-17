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

  const resourceName = getResourceNameFromPath(name);

  if (isResourceFunction(resourceName)) {
    await updateLambdaFunction(context, resourceName);
  } else if (isResourceLayer(resourceName)) {
    await updateLambdaLayer(context, resourceName);
  }
}

function getResourceNameFromPath(pathString) {
  return pathString.replace(functionDirectoryPath + path.sep, "").split(path.sep)[0];
}

function isResourceFunction(resourceName) {
  const meta = stateManager.getMeta();
  const resource = meta["function"][resourceName];
  return resource.service === "Lambda";
}

function isResourceLayer(resourceName) {
  const meta = stateManager.getMeta();
  const resource = meta["function"][resourceName];
  return resource.service === "LambdaLayer";
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

async function updateLambdaLayer(context, resourceName) {
  const { name: layerName, version: layerVersion } = parseLayerArn(resourceName);

  const zipPath = await createZip(path.join("amplify", "backend", "function", resourceName), { isFunction: false });

  const lambda = new AWS.Lambda();
  const { LayerVersionArn: layerVersionArn } = await lambda
    .publishLayerVersion({
      LayerName: layerName,
      CompatibleRuntimes: require(path.join(
        process.cwd(),
        "amplify",
        "backend",
        "function",
        resourceName,
        "parameters.json"
      )).runtimes,
      Content: {
        ZipFile: fs.readFileSync(zipPath),
      },
    })
    .promise();

  await Promise.all(
    findReferencedFunctionNames(resourceName).map((functionName) =>
      updateLayerDependency(functionName, layerVersionArn)
    )
  );
}

function parseLayerArn(resourceName) {
  const meta = stateManager.getMeta();
  const resource = meta["function"][resourceName];
  const [_, name, version] = resource.output.Arn.match(/arn:aws:lambda:.+:[\d]+:layer:([^:]+):([\d]+)/);
  return { name, version };
}

function findReferencedFunctionNames(resourceName) {
  const meta = stateManager.getMeta();
  return Object.values(meta["function"])
    .filter(
      (resource) =>
        resource.dependsOn && resource.dependsOn.find((dependency) => dependency.resourceName === resourceName)
    )
    .map((resource) => resource.output.Arn)
    .map((arn) => arn.match(/arn:aws:lambda:.*:[\d]*:function:([^:]*)/)[1]);
}

async function updateLayerDependency(functionName, layerVeresionArn) {
  const lambda = new AWS.Lambda();

  const currentConfiguration = await lambda.getFunctionConfiguration({ FunctionName: functionName }).promise();

  const currentLayersWithoutOld = currentConfiguration.Layers.map(({ Arn }) => Arn).filter(
    (arn) => !arn.startsWith(layerVeresionArn.replace(/:[\d]+$/, ""))
  );
  const newLayers = [...currentLayersWithoutOld, layerVeresionArn];

  await lambda
    .updateFunctionConfiguration({
      FunctionName: functionName,
      Layers: newLayers,
    })
    .promise();
}

async function createZip(dir, option = { isFunction: true }) {
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

    if (option.isFunction) {
      archive.directory(dir, false);
    } else {
      archive.directory(path.join(dir, "opt"), false);
      archive.directory(path.join(dir, "lib"), false);
    }

    archive.finalize();
  });
}

module.exports = {
  run,
};
