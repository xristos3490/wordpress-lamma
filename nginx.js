const { exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const colors = require("colors");
const Table = require("cli-table3");
colors.enable();

const {
  lammaDirectory,
  nginxDirectory,
  siteDirectory,
  logsDirectory,
  phpVersionsPath,
  nginxServersDirectory,
  sslNginxDirectory,
  LTD,
} = require("./constants.js");

function installNginxWithHomebrew() {
  return new Promise((resolve, reject) => {
    exec("brew list --formula | grep nginx", (error, stdout, stderr) => {
      if (error || stderr) {
        // Nginx is not installed
        exec(
          "brew install nginx",
          (installError, installStdout, installStderr) => {
            if (installError) {
              console.error("Error installing Nginx:", installError);
              reject(installError);
            } else {
              console.log("Nginx has been successfully installed.".grey);
              resolve(true);
            }
          }
        );
      } else {
        // Nginx is already installed
        console.log("Nginx is already installed.".grey);
        resolve(true);
      }
    });
  });
}

async function handleNginxInstallation() {
  console.log("- Installing Nginx...".yellow);
  await installNginxWithHomebrew();

  const nginxConfigPath = path.join(nginxDirectory, "nginx.conf");
  const backupConfigPath = path.join(nginxDirectory, "nginx.lamma.backup.conf");

  try {
    // Create a backup of nginx.conf as nginx.lamma.backup.conf
    if (!fs.existsSync(backupConfigPath)) {
      fs.copyFileSync(nginxConfigPath, backupConfigPath);
      console.log(`Backup of nginx.conf created as '${backupConfigPath}'`.grey);
    } else {
      console.log(
        `Backup of nginx.conf already exists as '${backupConfigPath}'`.grey
      );
    }

    // Content to be added to nginx.conf
    const contentToAdd = `
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    client_max_body_size 100M;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header 'Content-Security-Policy' 'upgrade-insecure-requests';
    server_names_hash_bucket_size 512;
    sendfile        on;
    keepalive_timeout  65;
    gzip  on;

    # Include Lamma Hosts.
    include servers/*;
}`;

    // Append the content to nginx.conf
    fs.writeFileSync(nginxConfigPath, contentToAdd);
    console.log("Content added to nginx.conf.".grey);

    console.log("Nginx configuration updated successfully.");
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}
exports.handleNginxInstallation = handleNginxInstallation;

function checkNginxStatus() {
  exec("brew services info nginx", (error, stdout, stderr) => {
    if (error || stderr) {
      console.error("Error checking Nginx status:", error || stderr);
    } else {
      const lines = stdout.split("\n");
      const runningLine = lines.find((line) => line.includes("Running:"));
      const loadedLine = lines.find((line) => line.includes("Loaded:"));

      if (runningLine && loadedLine) {
        const isRunning = runningLine.includes("true");
        const isLoaded = loadedLine.includes("true");

        if (isRunning) {
          console.log("Nginx is running.".blue);
        } else if (isLoaded) {
          console.log(
            "nginx is installed but not running as a service.".orange
          );
        } else {
          console.log("Nginx is not loaded or managed as a service.".red);
        }
      } else {
        console.log(
          "Nginx information not found. It may not be installed or managed as a service."
            .orange
        );
      }
    }
  });
}
exports.checkNginxStatus = checkNginxStatus;

function reloadNginx() {
  return new Promise(async (resolve, reject) => {
    exec("brew services restart nginx", (error, stdout, stderr) => {
      if (error || stderr) {
        console.error("Error reloading Nginx:", error || stderr);
        reject(error);
      } else {
        console.log("Nginx has been reloaded successfully.".blue);
        resolve(true);
      }
    });
  });
}
exports.reloadNginx = reloadNginx;

function listRunningPHPFPMVersions() {
  exec("ps aux | grep php-fpm", (error, stdout, stderr) => {
    if (error || stderr) {
      console.error("Error listing PHP-FPM versions:", error || stderr);
    } else {
      const lines = stdout.split("\n");
      const phpFPMVersions = {};

      lines.forEach((line) => {
        const match = line.match(
          /php-fpm: master process \((\/[^)]+)\/php\/(\d+\.\d+)\/php-fpm.conf\)/
        );
        if (match) {
          const version = match[2];
          phpFPMVersions[version] = true;
        }
      });

      const versionList = Object.keys(phpFPMVersions);
      if (versionList.length === 0) {
        console.log("No PHP-FPM processes found.");
      } else {
        console.log("Running PHP-FPM versions:", versionList.join(", "));
      }
    }
  });
}
exports.listRunningPHPFPMVersions = listRunningPHPFPMVersions;

function listPHPFPMInfo() {
  const phpFPMInfo = [];

  // Get a list of PHP version folders
  const phpVersionFolders = fs.readdirSync(phpVersionsPath);

  // Initialize an array to track running PHP-FPM versions
  const runningPHPFPMVersions = [];

  // Run `ps aux | grep php-fpm` to get running PHP-FPM processes
  exec("ps aux | grep php-fpm", (error, stdout, stderr) => {
    if (!error && !stderr) {
      const lines = stdout.split("\n");
      lines.forEach((line) => {
        const match = line.match(
          /php-fpm: master process \((\/[^)]+)\/php\/(\d+\.\d+)\/php-fpm.conf\)/
        );
        if (match) {
          const version = match[2];
          runningPHPFPMVersions.push(version);
        }
      });
    }

    phpVersionFolders.forEach((versionFolder) => {
      const versionPath = path.join(phpVersionsPath, versionFolder);
      let configFile = path.join(versionPath, "php-fpm.d", "www.conf");
      if ("5.6" === versionFolder) {
        configFile = path.join(versionPath, "php-fpm.conf");
      }
      const listenValue = readListenValue(configFile);
      const isRunning = runningPHPFPMVersions.includes(versionFolder);

      phpFPMInfo.push({
        version: versionFolder,
        listenPath: listenValue,
        configFile: configFile,
        isRunning: isRunning ? "Yes".blue : "No",
      });
    });

    displayTable(phpFPMInfo);
  });
}
exports.listPHPFPMInfo = listPHPFPMInfo;

function readListenValue(configFile) {
  try {
    const configFileContents = fs.readFileSync(configFile, "utf8");
    const listenMatch = configFileContents.match(/listen\s*=\s*(.+)/);
    if (listenMatch) {
      return listenMatch[1].trim();
    } else {
      return "Not found in config";
    }
  } catch (error) {
    return "Error reading config";
  }
}

function displayTable(phpFPMInfo) {
  const table = new Table({
    head: ["Version".cyan, "Listen".cyan, "Config File".cyan, "Running".cyan],
  });

  phpFPMInfo.forEach((info) => {
    table.push([
      info.version,
      info.listenPath,
      info.configFile,
      info.isRunning,
    ]);
  });

  console.log(table.toString());
}

/**
 * Setup and creates directories if they don't exist.
 *
 * @returns void
 */
function setupNginxFileDirectories() {
  if (!fs.existsSync(lammaDirectory)) {
    fs.mkdirSync(lammaDirectory);
    console.log(`Created ${lammaDirectory} folder`);
  }

  if (!fs.existsSync(nginxServersDirectory)) {
    fs.mkdirSync(nginxServersDirectory);
    console.log(`Created ${nginxServersDirectory} folder`);
  }

  // Create the ssl folder if it doesn't exist
  if (!fs.existsSync(sslNginxDirectory)) {
    fs.mkdirSync(sslNginxDirectory);
    console.log(`Created ${sslNginxDirectory} folder`);
  }
}
exports.setupNginxFileDirectories = setupNginxFileDirectories;

/**
 * Add a new config file for a site.
 *
 * @param {string} siteName
 * @param {string} sitePath
 *
 * @returns void
 */
function setupSite(siteName) {
  const sitePath = path.join(siteDirectory, siteName);
  const config = `server {
    listen 80;
    server_name ${siteName}${LTD};

    # Redirect HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${siteName}${LTD};

    # SSL certificate and key paths
    ssl_certificate ${sslNginxDirectory}/${siteName}${LTD}.crt;
    ssl_certificate_key ${sslNginxDirectory}/${siteName}${LTD}.key;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';

    # Logs
    error_log ${logsDirectory}/${siteName}.nginx.error.log;
    access_log ${logsDirectory}/${siteName}.nginx.access.log;

    # Set the root directory for your WordPress installation
    root ${sitePath};

    index index.php;

    # WordPress-specific rules
    location / {
        try_files $uri $uri/ /index.php$is_args$args;
    }

    # PHP-FPM configuration
    location ~ .php$ {
        fastcgi_pass 127.0.0.1:9027;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PHP_FLAG "display_errors=on \n display_startup_errors=on \n error_reporting=E_ALL";
        fastcgi_param PHP_VALUE "error_log=/users/chris/lamma/logs/nginxtest.nginx.php.error.log \n memory_limit=512M \n upload_max_filesize=128M \n post_max_size=128M";
    }
}
`;

  // Write the configuration file to a new file in sites-available
  fs.writeFileSync(`${nginxServersDirectory}/${siteName}.conf`, config);

  console.log(`- Added nginx configuration`.grey);
}
exports.setupSite = setupSite;

/**
 * Creates a self-signed SSL certificate.
 *
 * @param {string} siteName
 * @param {string} sitePath
 *
 * @returns void
 */
function createSSL(siteName) {
  // Generate a private key for the SSL certificate
  execSync(
    `openssl genrsa -out ${sslNginxDirectory}/${siteName}${LTD}.key 2048`
  );

  // Generate a self-signed SSL certificate
  execSync(
    `openssl req -new -x509 -key ${sslNginxDirectory}/${siteName}${LTD}.key -out ${sslNginxDirectory}/${siteName}${LTD}.crt -days 3650 -subj "/CN=${siteName}${LTD}"`
  );
}
exports.createSSL = createSSL;
