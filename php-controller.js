const fs = require("fs");
const path = require("path");
const { exec, execSync } = require("child_process");
const colors = require("colors");
const Table = require("cli-table3");
const { reloadNginx } = require("./nginx");
const { nginxServersDirectory } = require("./constants");
const inquirer = require("inquirer");
colors.enable();

// Specify the path to the folder containing PHP versions
const { phpVersionsPath } = require("./constants.js");

function getPhpVersions() {
  const versions = [];

  // Read the contents of the PHP folder
  const phpVersionFolders = fs.readdirSync(phpVersionsPath);

  for (const phpVersion of phpVersionFolders) {
    const versionPath = path.join(phpVersionsPath, phpVersion);

    // Check if it's a directory
    if (fs.statSync(versionPath).isDirectory()) {
      let wwwConfPath = path.join(versionPath, "php-fpm.d/www.conf");
      let phpIniPath = path.join(versionPath, "php.ini");

      // Check if it's PHP 5.6
      if ("5.6" === phpVersion) {
        wwwConfPath = path.join(versionPath, "php-fpm.conf");
        phpIniPath = path.join(versionPath, "php.ini");
      }

      try {
        const wwwConfData = fs.readFileSync(wwwConfPath, "utf8");

        // Extract relevant information from www.conf
        const listenMatch = wwwConfData.match(/listen\s+(.+?)(\s|;)/);
        const userMatch = wwwConfData.match(/user\s+(.+?)(\s|;)/);

        if (listenMatch && userMatch) {
          const versionInfo = {
            version: phpVersion,
            configFile: wwwConfPath,
            iniFile: phpIniPath,
            fpmPort: parseListenDirective(wwwConfData),
            userData: parseUserDirective(wwwConfData),
          };

          versions.push(versionInfo);
        }
      } catch (err) {
        console.error(
          `Error processing PHP version ${phpVersion}: ${err.message}`
        );
      }
    }
  }

  return versions;
}
exports.getPhpVersions = getPhpVersions;

function displayTable(phpFPMInfo) {
  const table = new Table({
    head: [
      "Version".cyan,
      "Running".cyan,
      "Listen".cyan,
      "Config File".cyan,
      ".ini File".cyan,
    ],
  });

  phpFPMInfo.forEach((info) => {
    table.push([
      info.version,
      info.isRunning,
      info.fpmPort,
      info.configFile,
      info.iniFile,
    ]);
  });

  console.log(table.toString());
}

function getRunningPHPFPMVersions() {
  return new Promise((resolve, reject) => {
    // Initialize an array to track running PHP-FPM versions
    const runningPHPFPMVersions = [];

    // Run `ps aux | grep php-fpm` to get running PHP-FPM processes
    exec("ps aux | grep php-fpm", (error, stdout, stderr) => {
      if (error || stderr) {
        reject(error || stderr);
        return;
      }

      const lines = stdout.split("\n");
      lines.forEach((line) => {
        // Try to match the format "php@X.X"
        const match = line.match(/php@(\d+\.\d+)/);
        // If not matched, try to match the format "php-fpm: master process ({phpVersionsPath}/X.X/php-fpm.conf)"
        if (!match) {
          const masterMatch = line.match(
            /php-fpm: master process \((\/[^)]+)\/php\/(\d+\.\d+)\/php-fpm.conf\)/
          );
          if (masterMatch) {
            const version = masterMatch[2];
            runningPHPFPMVersions.push(version);
          }
        } else {
          const version = match[1];
          runningPHPFPMVersions.push(version);
        }
      });

      resolve(runningPHPFPMVersions);
    });
  });
}
exports.getRunningPHPFPMVersions = getRunningPHPFPMVersions;

async function listPHPFPMInfo() {
  const phpFPMInfo = [];

  // Get a list of PHP version folders
  const phpVersionData = getPhpVersions();

  try {
    const runningPHPFPMVersions = await getRunningPHPFPMVersions();

    phpVersionData.forEach((versionData) => {
      const isRunning = runningPHPFPMVersions.includes(versionData.version);
      phpFPMInfo.push({
        ...versionData,
        isRunning: isRunning ? "Yes".blue : "No",
      });
    });

    displayTable(phpFPMInfo);
  } catch (error) {
    console.error(`Error getting running PHP-FPM versions: ${error}`);
  }
}
exports.listPHPFPMInfo = listPHPFPMInfo;

function parseListenDirective(wwwConfData) {
  const listenMatch = wwwConfData.match(/listen\s*=\s*[^:]+:(\d+)/);
  return listenMatch ? listenMatch[1].trim() : "N/A";
}

function parseUserDirective(wwwConfData) {
  const userMatch = wwwConfData.match(
    /user\s*=\s*([^;]+)\s*\n\s*group\s*=\s*([^;]+);/
  );
  return userMatch
    ? [userMatch[1].trim(), userMatch[2].trim()]
    : ["N/A", "N/A"];
}

function testAddPHP(version) {
  exec(`brew list | grep php@${version}`, (error, stdout, stderr) => {
    if (error) {
      console.error(
        `Error checking if PHP ${version} is installed: ${error.message}`
      );
      return;
    }

    if (stdout) {
      console.log(`PHP ${version} is already installed.`);
    } else {
      console.log(`Installing PHP ${version}...`);
      exec(
        `brew install php@${version}`,
        (installError, installStdout, installStderr) => {
          if (installError) {
            console.error(
              `Error installing PHP ${version}: ${installError.message}`
            );
          } else {
            console.log(`PHP ${version} has been successfully installed.`);
          }
        }
      );
    }
  });
}
exports.testAddPHP = testAddPHP;

function uninstallPhpVersion(version) {
  exec(`brew list | grep php@${version}`, (error, stdout, stderr) => {
    if (error) {
      console.error(
        `Error checking if PHP ${version} is installed: ${error.message}`
      );
      return;
    }

    if (stdout) {
      console.log(`Uninstalling PHP ${version}...`);
      exec(
        `brew uninstall php@${version}`,
        (uninstallError, uninstallStdout, uninstallStderr) => {
          if (uninstallError) {
            console.error(
              `Error uninstalling PHP ${version}: ${uninstallError.message}`
            );
          } else {
            console.log(`PHP ${version} has been successfully uninstalled.`);
          }
        }
      );
    } else {
      console.log(`PHP ${version} is not installed.`);
    }
  });
}
exports.uninstallPhpVersion = uninstallPhpVersion;

function modifyPhpConfig(configPath, fpmPort) {
  try {
    const wwwConfData = fs.readFileSync(configPath, "utf8");

    // Automatically get the current user using 'whoami'
    const user = execSync("whoami", { encoding: "utf8" }).trim();

    // Replace the user and listen directives
    const updatedConfData = wwwConfData
      .replace(/user\s*=\s*[^\n]+/, `user = ${user}`)
      .replace(
        /listen\s*=\s*127\.0\.0\.1:\d+/,
        `listen = 127.0.0.1:${fpmPort}`
      );

    // Write the updated configuration back to the file
    fs.writeFileSync(configPath, updatedConfData, "utf8");

    console.log(
      `PHP-FPM configuration updated with user ${user} and port ${fpmPort}.`
    );
  } catch (err) {
    console.error(`Error modifying PHP-FPM configuration: ${err.message}`);
  }
}
exports.modifyPhpConfig = modifyPhpConfig;

function restartPhpService(version) {
  exec(`brew services restart php@${version}`, (error, stdout, stderr) => {
    if (error) {
      console.error(
        `Error restarting PHP ${version} service: ${error.message}`
      );
      return;
    }

    console.log(`PHP ${version} service has been successfully restarted.`);
  });
}
exports.restartPhpService = restartPhpService;

function PhpDoctor() {
  const phpVersions = getPhpVersions();
  let portNumber = 9020;

  for (const versionInfo of phpVersions) {
    const { version, configFile } = versionInfo;
    const fpmPort = portNumber.toString();

    // Modify PHP-FPM configuration with the current port
    modifyPhpConfig(configFile, fpmPort);

    // Increment the port number for the next iteration
    portNumber++;
  }
}
exports.PhpDoctor = PhpDoctor;

function startPhpService(version) {
  exec(`brew services start php@${version}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error starting PHP ${version} service: ${error.message}`);
      return;
    }

    console.log(`PHP ${version} service has been successfully started.`);
  });
}
exports.startPhpService = startPhpService;

function stopPhpService(version) {
  exec(`brew services stop php@${version}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error stopping PHP ${version} service: ${error.message}`);
      return;
    }

    console.log(`PHP ${version} service has been successfully stopped.`);
  });
}
exports.stopPhpService = stopPhpService;

function getPhpVersionFromNginxConfig(nginxConfigPath) {
  const nginxConfig = fs.readFileSync(nginxConfigPath, "utf8");
  const phpVersions = getPhpVersions();
  let matchedVersion = null;

  // Regular expression to match the PHP-FPM fastcgi_pass directive
  const regex = /fastcgi_pass\s+127\.0\.0\.1:(\d+);/;

  const match = nginxConfig.match(regex);

  if (match && match[1]) {
    const portNumber = match[1];

    // Find the PHP version that matches the port number
    matchedVersion = phpVersions.find(
      (versionInfo) => versionInfo["fpmPort"] === portNumber
    );

    if (!matchedVersion) {
      return `No PHP version matched with FPM Port ${portNumber}`;
    }

    return matchedVersion.version;
  }
  return "N/A";
}
exports.getPhpVersionFromNginxConfig = getPhpVersionFromNginxConfig;

async function changePHP(configFilePath, phpVersion) {
  try {
    // Read the Nginx configuration file
    let nginxConfig = fs.readFileSync(configFilePath, "utf8");

    // Get the PHP version's FPM Port based on the provided PHP version string
    const phpVersions = getPhpVersions(); // Replace with the actual implementation of getPhpVersions
    const phpVersionInfo = phpVersions.find(
      (versionInfo) => versionInfo.version === phpVersion
    );

    if (!phpVersionInfo) {
      console.error(`PHP version ${phpVersion} not found in PHP versions.`);
      return;
    }

    const newPort = phpVersionInfo["fpmPort"];

    // Replace the PHP-FPM port number in the Nginx configuration
    const regex = /fastcgi_pass\s+127\.0\.0\.1:(\d+);/;
    nginxConfig = nginxConfig.replace(
      regex,
      `fastcgi_pass 127.0.0.1:${newPort};`
    );

    // Write the updated configuration back to the file
    fs.writeFileSync(configFilePath, nginxConfig, "utf8");
    await reloadNginx();
    console.log(
      `Updated PHP-FPM port to ${newPort} in Nginx config for PHP version ${phpVersion}.`
    );
  } catch (err) {
    console.error(`Error updating Nginx configuration: ${err.message}`);
  }
}
exports.changePHP = changePHP;

async function selectPHP(siteName) {
  try {
    const phpVersions = getPhpVersions();
    const choices = phpVersions.map((php) => ({
      name: php.version,
      value: php.version,
    }));
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "phpVersion",
        message: "Select a PHP version:",
        choices: choices,
      },
    ]);
    const phpVersion = answers.phpVersion;
    await changePHP(`${nginxServersDirectory}/${siteName}.conf`, phpVersion);
    console.log("Done.");
  } catch (error) {
    console.error(`Error setting PHP: ${error.stack}`.red);
  }
}
exports.selectPHP = selectPHP;

function addXdebugConfiguration(phpIniPath) {
  const configToAdd =
    '[xdebug]\nzend_extension="xdebug.so"\nxdebug.mode=debug\nxdebug.client_port=9003\nxdebug.idekey=PHPSTORM\n';

  // Check if the configuration already exists in php.ini
  const existingConfig = fs.readFileSync(phpIniPath, "utf8");
  if (existingConfig.indexOf("[xdebug]") === -1) {
    // Append the new configuration to the php.ini file
    fs.appendFileSync(phpIniPath, configToAdd);
    console.log("Added xdebug configuration to php.ini.");
  } else {
    console.log("xdebug configuration already exists in php.ini.");
  }
}

exports.addXdebugConfiguration = addXdebugConfiguration;
