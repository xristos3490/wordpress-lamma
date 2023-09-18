const fs = require("fs");
const colors = require("colors");
const path = require("path");
const yargs = require("yargs");
const Table = require("cli-table3");
const columnify = require("columnify");
const removeSite = require("./commands/remove_site_nginx");
const figlet = require("figlet");
const { exec, execSync, spawnSync } = require("child_process");

const {
  installWPCLI,
  runWPCommand,
  writeHostsFile,
  handleWatchLog,
  runProvision,
  wrapWithLoader,
  activatePlugins,
  activateTheme,
  unmanagePlugins,
} = require("./utils");

const {
  LTD,
  siteDirectory,
  nginxServersDirectory,
  sslNginxDirectory,
  SHELL_RC_FILES,
  HOMEBREW_DIRECTORY,
  logsDirectory,
} = require("./constants.js");

const {
  setupNginxFileDirectories,
  handleNginxInstallation,
  reloadNginx,
  checkNginxStatus,
  setupSite,
  createSSL,
} = require("./nginx");

colors.enable();

const {
  listPHPFPMInfo,
  PhpDoctor,
  getPhpVersionFromNginxConfig,
  getRunningPHPFPMVersions,
  changePHP,
} = require("./php-controller.js");

function printAsciiHeader() {
  console.log(
    figlet.textSync("lamma", {
      font: "Larry 3D",
      horizontalLayout: "universal smushing",
      verticalLayout: "fitted",
      width: 80,
      whitespaceBreak: false,
    })
  );
}

async function checkHomebrew() {
  return new Promise((resolve, reject) => {
    console.log("- Checking Homebrew status".yellow);
    exec("brew --version", (error, stdout, stderr) => {
      if (error || stderr) {
        console.error("Error checking Homebrew status:", error || stderr);
        reject(error);
      } else {
        // Check if brew prefix is set correctly.
        const brewPrefix = execSync("brew --prefix").toString().trim();
        if (brewPrefix !== HOMEBREW_DIRECTORY) {
          console.error(
            `Error: brew --prefix is set to ${brewPrefix} instead of ${HOMEBREW_DIRECTORY}`
              .red
          );
          reject(error);
          process.exit(1);
        } else {
          console.log("Homebrew is installed and configured correctly.".grey);
          resolve(true);
        }
      }
    });
  });
}

function checkNode() {
  const nvmrc = fs.readFileSync(path.join(__dirname, ".nvmrc"), "utf8").trim();
  const majorVersion = Number.parseInt(nvmrc.split(".")[0]);

  // Get the system's current major version
  const currentMajorVersion = Number.parseInt(
    process.version.split(".")[0].slice(1)
  );

  // Check if the major versions match
  if (majorVersion !== currentMajorVersion) {
    console.log(
      `Error: The system is running Node.js v${currentMajorVersion}, but this app requires v${majorVersion}`
        .red
    );
    return false;
  } else {
    return true;
  }
}

async function setupNginxAndPHP() {
  try {
    // Print header.
    console.log("\n===============================".yellow);
    console.log("\nInstalling Lamma...\n".yellow);

    await checkHomebrew();

    // Write RC File.
    console.log("- Checking shell".yellow);
    const SHELL = process.env.SHELL.split("/").slice(-1)[0];
    if (SHELL in SHELL_RC_FILES === false) {
      console.error(`Error: shell ${SHELL} is not supported.`.red);
      process.exit(1);
    } else {
      console.log(`Shell ${SHELL} is supported.`.grey);
    }

    const rcFile = SHELL_RC_FILES[SHELL];
    const rcFilePath = path.join(process.env.HOME, rcFile);
    const aliasCommand = `alias lamma='node ${path.join(
      __dirname,
      "app.js"
    )}'\n`;

    console.log("- Adding shell alias".yellow);
    await new Promise((resolve, reject) => {
      fs.readFile(rcFilePath, "utf-8", (err, data) => {
        // Add shortcut to source file.
        if (err) {
          console.error(`Error reading file: ${err.message}`.red);
          reject(err);
        } else if (data.includes(aliasCommand)) {
          console.log(`Alias command already exists in ${rcFile}.`.grey);
          resolve(true);
        } else {
          fs.appendFile(
            rcFilePath,
            "\n# wordpress-lamma\n" + aliasCommand,
            (err) => {
              if (err) {
                console.error(`Error writing file: ${err.message}`.red);
                reject(err);
              }

              console.log(`Alias command added to ${rcFile}.`.grey);

              if (SHELL === "fish") {
                console.log(
                  "Please reload the fish shell to make the alias available"
                    .grey
                );
              } else {
                console.log(
                  `Please run `.grey +
                    `source ${rcFilePath}`.yellow +
                    ` to make the alias available`.grey
                );
              }
              resolve(true);
            }
          );
        }
      });
    });

    await handleNginxInstallation();

    console.log("- Setting up Nginx Directories".yellow);
    setupNginxFileDirectories();

    // Check if PHP 8.1 is installed using brew list
    let php81Installed = false;
    try {
      const brewListOutput = execSync("brew list | grep php@8.1", {
        encoding: "utf-8",
      });
      php81Installed = brewListOutput.trim() !== "";
    } catch (phpError) {
      php81Installed = false;
    }

    console.log("- Installing PHP 8.1...".yellow);
    if (php81Installed) {
      console.log("PHP 8.1 is already installed.".grey);
    } else {
      // Install PHP 8.1 if it's not already installed
      execSync("brew install php@8.1");
      console.log("PHP 8.1 has been installed.".grey);
    }

    await reloadNginx();
  } catch (error) {
    // Handle any errors
    console.error("Error:", error.message);
  }
}

function boot() {
  // Check NodeJS.
  if (!checkNode()) {
    process.exit(1);
  }

  if (["setup", "help", "-h", "--help", ""].includes(process.argv[2])) {
    printAsciiHeader();
  }

  // Yargs.
  const argv = yargs
    .scriptName("lamma")
    .showHelpOnFail(true)
    .usage("Usage: $0 <command> [options]")
    .version("1.0.0")
    .command("sites", "List all sites", (yargs) => {
      yargs.option("all", {
        describe: "Show verbose list",
        type: "boolean",
        default: false,
      });
    })
    .command("info <name>", "Get information of a site", (yargs) => {
      yargs.positional("name", {
        describe: "The name of the site to get info",
        type: "string",
      });
    })
    .command(
      "add-plugins <name>",
      "Adds a symlink to a plugin inside the ~/.woa_projects.json file in the site's plugins directory",
      (yargs) => {
        yargs.positional("name", {
          describe: "The name of the site to add the plugin to",
          type: "string",
        });
      }
    )
    .command(
      "unmanage-plugins <name>",
      "Removes a symlink to a plugin inside the ~/.woa_projects.json file in the site's plugins directory",
      (yargs) => {
        yargs.positional("name", {
          describe: "The name of the site to remove the managed plugin from",
          type: "string",
        });
      }
    )
    .command("switch-theme <name>", "Switches the theme of a site", (yargs) => {
      yargs.positional("name", {
        describe: "The name of the site to switch theme",
        type: "string",
      });
    })
    .command("add", "Add a new site", (yargs) => {
      yargs
        .option("name", {
          describe: "The name of the site",
          type: "string",
          demandOption: true,
        })
        .option("title", {
          describe: "The title of the site",
          type: "string",
        })
        .option("theme", {
          describe: "The ID of the theme to use",
          type: "string",
        })
        .option("plugins", {
          describe: "A comma-separated list of plugin IDs to use",
          type: "array",
          default: [],
        });
    })
    .command("remove <name>", "Remove a site", (yargs) => {
      yargs.positional("name", {
        describe: "The name of the site to remove",
        type: "string",
      });
    })
    .command("logs <name>", "Shows logs of a site", (yargs) => {
      yargs.positional("name", {
        describe: "The name of the site to watch logs",
        type: "string",
      });
    })
    .command(
      "php-change <name> <phpVersion>",
      "Change the PHP version of a site",
      (yargs) => {
        yargs
          .positional("name", {
            describe: "The name of the site to change PHP version",
            type: "string",
          })
          .positional("phpVersion", {
            describe: "The version of PHP to use",
            type: "string",
          });
      }
    )
    .command("wp <name>", "WP CLI alias for the specific site", (yargs) => {
      yargs.positional("name", {
        describe: "The name of the site to run WP CLI commands",
        type: "string",
      });
    })
    .command("server <action>", "Manage the Nginx server", (yargs) => {
      yargs.positional("action", {
        describe:
          "The action to perform. It can be install, status, reload, and php",
        type: "string",
      });
    })
    .command("hosts-doctor", "Fix the hosts file for all sites")
    .command(
      "php-doctor",
      "It assigns a distinct port number starting from 9020 to each version of PHP-FPM and sets the process owner to the current user. Please be careful while running this script as it may cause interruptions to existing connections to PHP servers on your sites."
    )
    .command("setup", "Setup Nginx and PHP")
    .help()
    .alias("h", "help")
    .alias("v", "version")
    .wrap(90).argv;

  switch (argv._[0]) {
    case "setup":
      setupNginxAndPHP();
      return;
    case "sites":
      handleNginxSitesCommand(argv.all);
      return;
    case "info":
      handleNginxInfoCommand(argv.name);
      return;
    case "php-doctor":
      PhpDoctor();
      return;
    case "php-change":
      changePHP(`${nginxServersDirectory}/${argv.name}.conf`, argv.phpVersion);
      return;
    case "add-plugins":
      activatePlugins(path.join(siteDirectory, argv.name), []);
      return;
    case "unmanage-plugins":
      unmanagePlugins(argv.name);
      return;
    case "switch-theme":
      activateTheme(path.join(siteDirectory, argv.name), false);
      return;
    case "add":
      handleNginxAddCommand(argv.name, argv.theme, argv.plugins, argv.title);
      return;
    case "remove":
      handleRemoveCommand(argv.name);
      return;
    case "logs":
      handleWatchLog(argv.name);
      return;
    case "hosts-doctor":
      handleHostsDoctor();
      return;
    case "wp":
      wpAlias(argv.name);
      return;
    case "server":
      switch (argv.action) {
        case "install":
          handleNginxInstallation();
          return;
        case "status":
          checkNginxStatus();
          return;
        case "reload":
          reloadNginx();
          return;
        case "php":
          listPHPFPMInfo();
          return;
        case "test":
          // TESTING.
          // restoreWordPressSite("storefront");
          unmanagePlugins("woo");
          return;
        default:
          console.error(`Invalid command: ${argv._[1]}`);
          process.exit(1);
      }
      return;
    default:
      console.error(`Invalid command: ${argv._[0]}`);
      process.exit(1);
  }
}
exports.boot = boot;

async function handleNginxInfoCommand(siteName = false) {
  try {
    const sitePath = path.join(siteDirectory, siteName);

    const [theme, wpVersion, plugins] = await wrapWithLoader(
      `Fetching site data for ${siteName}...`,
      async () => {
        const [theme, wpVersion] = await Promise.all([
          runWPCommand(
            "theme list --skip-themes --skip-plugins --status=active --field=name",
            {
              cwd: sitePath,
            }
          ).then((output) => output.trim()),
          runWPCommand("core version --skip-themes --skip-plugins", {
            cwd: sitePath,
          }).then((output) => output.trim()),
        ]);
        const plugins = await runWPCommand(
          "plugin list --skip-themes --skip-plugins",
          {
            cwd: sitePath,
          }
        ).then((output) => output.trim().split("\n"));
        return [theme, wpVersion, plugins];
      }
    );

    const symlinkedPlugins = [];

    for (const pluginsRow of plugins) {
      const [name, status, update, version] = pluginsRow.trim().split(/\s+/);
      const pluginPath = path.join(
        `${siteDirectory}/${siteName}/wp-content/plugins`,
        name
      );

      try {
        const stats = fs.lstatSync(pluginPath);

        if (stats.isSymbolicLink()) {
          symlinkedPlugins.push(name);
        }
      } catch (err) {
        // Ignore
      }
    }

    let isThemeManaged = false;
    const themePath = path.join(
      `${siteDirectory}/${siteName}/wp-content/themes`,
      theme
    );

    try {
      const stats = fs.lstatSync(themePath);

      if (stats.isSymbolicLink()) {
        isThemeManaged = true;
      }
    } catch (err) {
      // Ignore
    }

    const nginxConfigPath = `${nginxServersDirectory}/${siteName}.conf`;
    const phpVersion = getPhpVersionFromNginxConfig(nginxConfigPath);

    const runningPHPFPMVersions = await getRunningPHPFPMVersions();
    const phpValue = runningPHPFPMVersions.includes(phpVersion)
      ? phpVersion + " (Running)".blue
      : phpVersion + " (Not running)".grey;

    // Print site information as a list
    const data = {
      Name: siteName,
      URL: `https://${siteName}.test`,
      Theme: isThemeManaged ? theme + " (Managed)".blue : theme,
      PHP: phpValue,
      "WP Version": wpVersion,
      "Document Root": sitePath,
      "Config File": nginxConfigPath,
      "Managed Projects Config": "~/.woa_projects.json",
    };
    console.log(`Site Information (${siteName})`.blue);
    const siteList = [];
    for (const [key, value] of Object.entries(data)) {
      siteList.push([`${key}:`.cyan, value]);
    }
    console.log(columnify(siteList, { showHeaders: false }));

    // Print installed plugins as a table
    console.log(`\nInstalled Plugins (${plugins.length - 1})`.blue);
    const pluginsTable = new Table({
      head: [
        "Plugin Name".cyan,
        "Status".cyan,
        "Version".cyan,
        "Is Managed".cyan,
      ],
      colWidths: [50, 15, 15, 15],
    });
    for (let i = 1; i < plugins.length; i++) {
      const [name, status, update, version] = plugins[i].trim().split(/\s+/);
      pluginsTable.push([
        name,
        status,
        version,
        symlinkedPlugins.includes(name) ? "Yes".blue : "No".grey,
      ]);
    }
    console.log(pluginsTable.toString());
  } catch (err) {
    console.error(err);
  }
}

async function handleHostsDoctor() {
  const files = await fs.promises.readdir(nginxServersDirectory);
  // Filter the files to only include those with the .conf extension
  const confFiles = files.filter((file) => path.extname(file) === ".conf");

  // Create a list of the conf file names with additional data
  confFiles.map((file) => {
    const siteName = path.basename(file, ".conf");
    writeHostsFile(siteName);
  });
}

async function handleNginxSitesCommand(show = false) {
  try {
    const siteData = await wrapWithLoader("Fetching sites...", async () => {
      // Read the files in the directory
      const files = await fs.promises.readdir(nginxServersDirectory);

      // Filter the files to only include those with the .conf extension
      const confFiles = files.filter((file) => path.extname(file) === ".conf");

      // Create a list of the conf file names with additional data
      const siteDataPromises = confFiles.map(async (file) => {
        const siteName = path.basename(file, ".conf");
        const sitePath = path.join(siteDirectory, siteName);
        const data = {
          name: siteName,
          url: `https://${siteName}.test`,
        };

        if (show) {
          const runningPHPFPMVersions = await getRunningPHPFPMVersions();
          const [theme, wpVersion, phpValue, folderSize, dbSize] =
            await Promise.all([
              runWPCommand(
                "theme list --status=active --field=name --skip-themes --skip-plugins",
                {
                  cwd: sitePath,
                }
              ).then((output) => output.trim()),
              runWPCommand("core version --skip-themes --skip-plugins", {
                cwd: sitePath,
              }).then((output) => output.trim()),
              new Promise((resolve, reject) => {
                const phpVersion = getPhpVersionFromNginxConfig(
                  `${nginxServersDirectory}/${siteName}.conf`
                );
                const phpValue = runningPHPFPMVersions.includes(phpVersion)
                  ? phpVersion + " (Running)".blue
                  : phpVersion + " (Not running)".grey;
                resolve(phpValue);
              }),
              new Promise((resolve, reject) => {
                exec(
                  `du -sh ${sitePath} | cut -f1`,
                  (error, stdout, stderr) => {
                    if (error) {
                      reject(error);
                    } else {
                      resolve(stdout.trim());
                    }
                  }
                );
              }),
              new Promise((resolve, reject) => {
                const query = `
    SELECT SUM(data_length + index_length) AS total_size
    FROM information_schema.tables
    WHERE table_schema = '${siteName}';
  `;
                // Handle the password part to support empty passwords.
                const passwordPart = process.env.DB_PASSWORD
                  ? ` -p${process.env.DB_PASSWORD}`
                  : "";
                const command = `mysql -u${process.env.DB_USER}${passwordPart} -e "${query}"`;
                exec(command, (error, stdout, stderr) => {
                  if (error) {
                    reject(error);
                    return;
                  }

                  const output = stdout.trim();
                  const match = output.match(/\d+/); // Use a regex to extract numbers

                  if (match) {
                    const totalSizeBytes = parseInt(match[0], 10);
                    const totalSizeMB = Math.floor(
                      totalSizeBytes / (1024 * 1024)
                    );
                    resolve(totalSizeMB + "MB");
                  } else {
                    reject(output);
                  }
                });
              }),
            ]);

          Object.assign(data, {
            theme,
            wpVersion,
            phpVersion: phpValue,
            folderSize,
            dbSize,
          });
        }
        return data;
      });

      // Wait for all the promises to complete
      return await Promise.all(siteDataPromises);
    });

    // Print the sites as a table or list
    console.log(`Sites available (${siteData.length})`.blue);

    if (show) {
      const table = new Table({
        head: [
          "Site Name".cyan,
          "URL".cyan,
          "Theme".cyan,
          "WP Version".cyan,
          "PHP Version".cyan,
          "Total Size".cyan,
          "DB Size".cyan,
        ],
        colWidths: [25, 40, 25, 20, 20],
      });
      siteData.forEach((data) =>
        table.push([
          data.name,
          `${data.url}`.white,
          data.theme,
          data.wpVersion,
          data.phpVersion,
          data.folderSize,
          data.dbSize,
        ])
      );
      console.log(table.toString());
    } else {
      const table = new Table({
        head: ["Site Name".cyan, "URL".cyan],
        colWidths: [25, 30],
      });
      siteData.forEach((data) => table.push([data.name, data.url]));
      console.log(table.toString());
    }
  } catch (err) {
    console.error(err);
  }
}

async function handleRemoveCommand(name) {
  const sitePath = path.join(siteDirectory, name);

  if (!fs.existsSync(sitePath)) {
    console.log(`Site '${name}' doesn't exist`.grey);
    return;
  }

  const site = {
    name: `${name}`,
    database: `${name}`,
    directory: `${sitePath}`,
    configFile: `${nginxServersDirectory}/${name}.conf`,
    sslKey: `${sslNginxDirectory}/${name}${LTD}.key`,
    sslCrt: `${sslNginxDirectory}/${name}${LTD}.crt`,
    hostsFile: "/etc/hosts",
  };

  try {
    removeSite(site);
    return;
  } catch (error) {
    console.error(`Error removing site ${site.name}: ${error.stack}`);
  }
}

async function handleNginxAddCommand(siteName, theme, plugins, title) {
  const sitePath = path.join(siteDirectory, siteName);

  // Check if the site name already exists
  if (fs.existsSync(`${nginxServersDirectory}/${siteName}.conf`)) {
    console.log(`Virtual host for ${siteName}${LTD} already exists`);
    process.exit(1);
  }

  // Check if the site directory already exists
  if (fs.existsSync(sitePath)) {
    console.error(`The site directory ${sitePath} already exists.`);
    process.exit(1);
  }

  // Create the site directory
  fs.mkdirSync(sitePath);

  // Create the log file.
  fs.writeFileSync(`${logsDirectory}/${siteName}.php.log`, "");

  // Setup server.
  console.log("Configuring server".blue);
  createSSL(siteName);
  setupSite(siteName);

  installWPCLI();

  runProvision(title, siteName, sitePath, theme, plugins)
    .then(() => {
      console.log(
        `\nTask completed successfully.`.green +
          ` \n\nYou new site is available at https://${siteName}.test\nDocument root is at: ${sitePath}\n\nHappy coding! :)`
            .green
      );
    })
    .catch((error) => {
      console.error(`\nTask failed: ${error.stack}`.red);
    });
}

function wpAlias(siteName) {
  // Get all command-line arguments after the function name
  const args = process.argv.slice(4); // Assuming the function name is in argv[2]

  // Check if there are arguments to pass to the `wp` command
  if (args.length === 0) {
    console.log("No arguments provided to pass to the `wp` command.");
    return;
  }
  const sitePath = path.join(siteDirectory, siteName);
  // Run the `wp` command with the provided arguments
  const result = spawnSync("wp", args, { cwd: sitePath, stdio: "inherit" });

  // Check if the command was successful
  if (result.status !== 0) {
    console.error("Error executing `wp` command.");
  }
}
