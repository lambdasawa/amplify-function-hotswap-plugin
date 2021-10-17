async function run(context) {
  context.print.info("");

  context.amplify.showHelp("amplify <command> <subcommand>", [
    {
      name: "watch",
      description: "Watch amplify/backend/function and call lambda:UpdateFunctionCode.",
    },
    {
      name: "version",
      description: "Show plugin version.",
    },
    {
      name: "help",
      description: "Show this help.",
    },
  ]);

  context.print.info("");
}

module.exports = {
  run,
};
