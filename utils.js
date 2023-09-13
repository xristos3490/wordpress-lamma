const path = require("path");
const { exec, execSync } = require("child_process");
const fs = require("fs");
const colors = require("colors");
const tail = require("tail");
const mysql = require("mysql2/promise");
const inquirer = require("inquirer");
const spinners = require("cli-spinners");

colors.enable();
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const {
  LTD,
  logsDirectory,
  siteDirectory,
  LOCAL_WOO_PATH,
  LOCAL_DUMMY_PATH,
} = require("./constants.js");

const { selectPHP } = require("./php-controller.js");
const { reloadNginx } = require("./nginx.js");

// ======================================
// Generic helpers.
// ======================================

/**
 * Wraps a callback with a loader.
 *
 * @param {string} text
 * @param {function} callback
 * @returns {Promise}
 */
async function wrapWithLoader(text, callback) {
  const spinner = {
    frames: spinners.dots4.frames,
    interval: spinners.dots4.interval,
    text,
    frame: 0,
  };

  // Create a new spinner instance and start it
  process.stdout.write(`\n`);
  const loader = setInterval(() => {
    process.stdout.write(
      `\r${spinner.text} ${spinner.frames[spinner.frame]}`.cyan
    );
    spinner.frame = (spinner.frame + 1) % spinner.frames.length;
  }, spinner.interval);

  const response = await callback();

  // Stop the loader and clear the line
  clearInterval(loader);
  process.stdout.write("\r\x1b[K");

  return response;
}
exports.wrapWithLoader = wrapWithLoader;

/**
 * Fetches the projects from the .woa_projects.json file.
 *
 * @returns {array}
 */
function fetchProjects() {
  const PROJECTS_CONFIG_FILE_NAME = ".woa_projects.json";
  const PROJECTS_WOA_DEV_FILE = path.join(
    process.env.HOME,
    PROJECTS_CONFIG_FILE_NAME
  );

  const tasks = [];
  if (fs.existsSync(PROJECTS_WOA_DEV_FILE)) {
    try {
      const projects = JSON.parse(
        fs.readFileSync(PROJECTS_WOA_DEV_FILE, "utf8")
      );
      if (!projects || !projects.length) {
        console.error(
          `- Projects are empty in ${PROJECTS_WOA_DEV_FILE} file.`.grey
        );
      }

      projects.forEach((project) => {
        tasks.push(project);
      });
    } catch (error) {
      console.error(
        `There is an error in your ${PROJECTS_WOA_DEV_FILE} file. Please ensure that no trailing commas exist in the configuration.`
          .red
      );
      console.error(error);
      process.exit(1);
    }
  }

  return tasks;
}
exports.fetchProjects = fetchProjects;

/**
 * Writes an entry to the hosts file.
 *
 * @param {string} siteName
 *
 * @returns boolean
 */
function writeHostsFile(siteName) {
  // Add the site to /etc/hosts if it doesn't exist
  const hostsFilePath = "/etc/hosts";
  const hostsFile = fs.readFileSync(hostsFilePath, "utf-8");

  // Define the block pattern
  const blockStartPattern = `# Lamma: ${siteName} START`;
  const blockEndPattern = `# Lamma: ${siteName} END`;

  // Check if the block already exists
  if (
    !hostsFile.includes(`${blockStartPattern}\n`) ||
    !hostsFile.includes(`\n${blockEndPattern}`)
  ) {
    const tempHostsFile = path.join(__dirname, "temp_hosts");

    // If the block doesn't exist, add the updated format
    const siteHostsBlock = `# Lamma: ${siteName} START\n::1 ${siteName}${LTD}\n127.0.0.1 ${siteName}${LTD}\n# Lamma: ${siteName} END\n`;

    fs.writeFileSync(tempHostsFile, `${hostsFile}\n${siteHostsBlock}`);
    execSync(`sudo sh -c 'cat "${tempHostsFile}" > "${hostsFilePath}"'`);
    fs.unlinkSync(tempHostsFile);
    console.log(`- Added ${siteName}${LTD} to /etc/hosts`.grey);
    return true;
  } else {
    console.log(
      `- ${siteName}${LTD} is already included in the hosts file`.grey
    );
    return false;
  }
}
exports.writeHostsFile = writeHostsFile;

async function handleWatchLog(siteName) {
  const tailStream = new tail.Tail(
    path.join(logsDirectory, siteName + ".php.log"),
    { fromBeginning: false, nLines: 100 }
  );
  tailStream.on("line", (line) => {
    const match = line.match(/^\[(.*)\] (.*)/);
    if (match) {
      const timestamp = colors.gray(match[1]);
      const message = match[2].replace(/(\r\n|\n|\r)/gm, "");
      console.log(`${timestamp.cyan}` + ` ${message.white}`);
    } else {
      console.log(line.white);
    }
  });
}
exports.handleWatchLog = handleWatchLog;

/**
 * Creates a new database for the given site name.
 *
 * @param {string} siteName
 *
 * @returns void
 */
async function createDatabase(siteName) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "",
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${siteName}`);
    console.log(`- Database '${siteName}' created (or already exists)`.grey);
  } catch (error) {
    console.error(`Error creating database: ${error.stack}`.red);
  } finally {
    await connection.end();
  }
}
exports.createDatabase = createDatabase;

// Generic helper.
function createSymlinks(sitePath, symlinks = []) {
  symlinks = symlinks.length ? symlinks : fetchDefaultSymlinks(sitePath);
  if (!symlinks.length) {
    console.log(`No default symlinks found. Moving on...`.grey);
  }

  try {
    symlinks.forEach((symlink) => {
      fs.symlinkSync(symlink.source, symlink.target, "dir");
      console.log(
        `- Symlink from "${symlink.source}" to "${symlink.target}"`.grey
      );
    });
  } catch (error) {
    console.error(`Error creating symlinks: ${error.stack}`.red);
  }
}
exports.createSymlinks = createSymlinks;

// ======================================
// WordPress helpers.
// ======================================

/**
 * Installs WP CLI If it doesn't exists.
 *
 * @returns void
 */
function installWPCLI() {
  try {
    const wpPath = execSync("which wp").toString().trim();

    if (wpPath) {
      console.log(`- WP-CLI is already installed at '${wpPath}'`.grey);
      return;
    }

    execSync(
      "curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && sudo mv wp-cli.phar /usr/local/bin/wp"
    );
    console.log("- WP-CLI installed successfully".grey);
  } catch (error) {
    console.error(`Error installing WP-CLI: ${error.stack}`.red);
  }
}
exports.installWPCLI = installWPCLI;

/**
 * Runs a WP command.
 *
 * @param {string} command
 * @param {object} options - Options to pass to the exec function.
 *
 * @returns {Promise}
 */
function runWPCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const { cwd = process.cwd(), ...otherOptions } = options;

    // Check if the command already starts with 'wp '.
    const wpCommand = command.startsWith("wp ") ? command : `wp ${command}`;

    const execOptions = { cwd, ...otherOptions };

    exec(wpCommand, execOptions, (error, stdout, stderr) => {
      if (error) {
        console.log(`Error running WP command: ${error.stack}`.red);
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}
exports.runWPCommand = runWPCommand;

// Generic helper.
function fetchDefaultSymlinks(sitePath) {
  if (undefined === LOCAL_WOO_PATH || !LOCAL_WOO_PATH) {
    return [];
  }

  const symlinks = [
    {
      source: LOCAL_WOO_PATH,
      target: `${sitePath}/wp-content/plugins/woocommerce`,
    },
    {
      source: LOCAL_DUMMY_PATH,
      target: `${sitePath}/wp-content/plugins/woocommerce-gateway-dummy`,
    },
  ];

  return symlinks;
}
exports.fetchDefaultSymlinks = fetchDefaultSymlinks;

/**
 * Returns an object with two arrays of commands to run before and after WordPress installation.
 *
 * @param {string} title
 * @param {string} siteName
 *
 * @returns {Object}
 */
function fetchProvisionCommands(title, siteName) {
  const installCommands = [
    `core download --locale=en_US --force`,
    `core config --dbname=${siteName} --dbuser=${process.env.DB_USER} --dbpass=${process.env.DB_PASSWORD} --dbhost=${process.env.DB_HOST} --dbprefix=${process.env.DB_PREFIX} --skip-check`,
    `core install --url=${siteName}${LTD} --title="${
      title ? title : "My Awesome Site"
    }" --admin_user=${process.env.WP_ADMIN_USER} --admin_password=${
      process.env.WP_ADMIN_PASSWORD
    } --admin_email=${process.env.WP_ADMIN_EMAIL} --skip-email`,
    `option update siteurl ${siteName}${LTD}`,
    `rewrite structure '/%postname%/'`,
  ];

  const postInstallCommands = [
    `plugin activate woocommerce`,
    `plugin activate woocommerce-gateway-dummy`,
    `wc customer update 1 --user=1 --billing='{"first_name":"John","last_name":"Doe","company":"Automattic","country":"US","address_1":"addr 1","address_2":"addr 2","city":"San Francisco","state":"CA","postcode":"94107","phone":"123456789"}' --shipping='{"first_name":"John","last_name":"Doe","company":"Automattic","country":"US","address_1":"addr 1","address_2":"addr 2","city":"San Francisco","state":"CA","postcode":"94107","phone":"123456789"}'`,
    `option update woocommerce_store_address '60 29th Street #343'`,
    `option update woocommerce_store_city 'San Francisco'`,
    `option update woocommerce_store_postcode 94110`,
    `option update woocommerce_default_country 'US:CA'`,
    `option update woocommerce_default_customer_address 'geolocation'`,
    `option update woocommerce_currency 'USD'`,
    `option update woocommerce_currency_pos 'left'`,
    `option update woocommerce_onboarding_profile --format=json '{"skipped":true}'`,
    `wp option set --format=json woocommerce_dummy_settings '{"enabled":"yes","title":"Dummy Payment","description":"The goods are yours. No money needed.","result":"success"}'`,
    `post create --post_type=page --post_status=publish --post_title='Blocks cart' --post_name='blocks-cart' --post_content='<!-- wp:woocommerce/cart {"align":"wide"} --><div class="wp-block-woocommerce-cart alignwide is-loading"><!-- wp:woocommerce/filled-cart-block --><div class="wp-block-woocommerce-filled-cart-block"><!-- wp:woocommerce/cart-items-block --><div class="wp-block-woocommerce-cart-items-block"><!-- wp:woocommerce/cart-line-items-block --><div class="wp-block-woocommerce-cart-line-items-block"></div><!-- /wp:woocommerce/cart-line-items-block --></div><!-- /wp:woocommerce/cart-items-block --><!-- wp:woocommerce/cart-totals-block --><div class="wp-block-woocommerce-cart-totals-block"><!-- wp:woocommerce/cart-order-summary-block --><div class="wp-block-woocommerce-cart-order-summary-block"></div><!-- /wp:woocommerce/cart-order-summary-block --><!-- wp:woocommerce/cart-express-payment-block --><div class="wp-block-woocommerce-cart-express-payment-block"></div><!-- /wp:woocommerce/cart-express-payment-block --><!-- wp:woocommerce/proceed-to-checkout-block --><div class="wp-block-woocommerce-proceed-to-checkout-block"></div><!-- /wp:woocommerce/proceed-to-checkout-block --><!-- wp:woocommerce/cart-accepted-payment-methods-block --><div class="wp-block-woocommerce-cart-accepted-payment-methods-block"></div><!-- /wp:woocommerce/cart-accepted-payment-methods-block --></div><!-- /wp:woocommerce/cart-totals-block --></div><!-- /wp:woocommerce/filled-cart-block --><!-- wp:woocommerce/empty-cart-block --><div class="wp-block-woocommerce-empty-cart-block"><!-- wp:image {"align":"center","sizeSlug":"small"} --><div class="wp-block-image"><figure class="aligncenter size-small"><img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzgiIGhlaWdodD0iMzgiIHZpZXdCb3g9IjAgMCAzOCAzOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE5IDBDOC41MDQwMyAwIDAgOC41MDQwMyAwIDE5QzAgMjkuNDk2IDguNTA0MDMgMzggMTkgMzhDMjkuNDk2IDM4IDM4IDI5LjQ5NiAzOCAxOUMzOCA4LjUwNDAzIDI5LjQ5NiAwIDE5IDBaTTI1LjEyOSAxMi44NzFDMjYuNDg1MSAxMi44NzEgMjcuNTgwNiAxMy45NjY1IDI3LjU4MDYgMTUuMzIyNkMyNy41ODA2IDE2LjY3ODYgMjYuNDg1MSAxNy43NzQyIDI1LjEyOSAxNy43NzQyQzIzLjc3MyAxNy43NzQyIDIyLjY3NzQgMTYuNjc4NiAyMi42Nzc0IDE1LjMyMjZDMjIuNjc3NCAxMy45NjY1IDIzLjc3MyAxMi44NzEgMjUuMTI5IDEyLjg3MVpNMTEuNjQ1MiAzMS4yNTgxQzkuNjE0OTIgMzEuMjU4MSA3Ljk2Nzc0IDI5LjY0OTIgNy45Njc3NCAyNy42NTczQzcuOTY3NzQgMjYuMTI1IDEwLjE1MTIgMjMuMDI5OCAxMS4xNTQ4IDIxLjY5NjhDMTEuNCAyMS4zNjczIDExLjg5MDMgMjEuMzY3MyAxMi4xMzU1IDIxLjY5NjhDMTMuMTM5MSAyMy4wMjk4IDE1LjMyMjYgMjYuMTI1IDE1LjMyMjYgMjcuNjU3M0MxNS4zMjI2IDI5LjY0OTIgMTMuNjc1NCAzMS4yNTgxIDExLjY0NTIgMzEuMjU4MVpNMTIuODcxIDE3Ljc3NDJDMTEuNTE0OSAxNy43NzQyIDEwLjQxOTQgMTYuNjc4NiAxMC40MTk0IDE1LjMyMjZDMTAuNDE5NCAxMy45NjY1IDExLjUxNDkgMTIuODcxIDEyLjg3MSAxMi44NzFDMTQuMjI3IDEyLjg3MSAxNS4zMjI2IDEzLjk2NjUgMTUuMzIyNiAxNS4zMjI2QzE1LjMyMjYgMTYuNjc4NiAxNC4yMjcgMTcuNzc0MiAxMi44NzEgMTcuNzc0MlpNMjUuOTEwNSAyOS41ODc5QzI0LjE5NDQgMjcuNTM0NyAyMS42NzM4IDI2LjM1NDggMTkgMjYuMzU0OEMxNy4zNzU4IDI2LjM1NDggMTcuMzc1OCAyMy45MDMyIDE5IDIzLjkwMzJDMjIuNDAxNiAyMy45MDMyIDI1LjYxMTcgMjUuNDA0OCAyNy43ODc1IDI4LjAyNUMyOC44NDQ4IDI5LjI4MTUgMjYuOTI5NCAzMC44MjE0IDI1LjkxMDUgMjkuNTg3OVoiIGZpbGw9ImJsYWNrIi8+Cjwvc3ZnPgo=" alt=""/></figure></div><!-- /wp:image --><!-- wp:heading {"textAlign":"center","className":"wc-block-cart__empty-cart__title"} --><h2 class="has-text-align-center wc-block-cart__empty-cart__title">Your cart is currently empty!</h2><!-- /wp:heading --><!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center"><a href="http://localhost:8889/shop/">Browse store</a>.</p><!-- /wp:paragraph --><!-- wp:separator {"className":"is-style-dots"} --><hr class="wp-block-separator is-style-dots"/><!-- /wp:separator --><!-- wp:heading {"textAlign":"center"} --><h2 class="has-text-align-center">New in store</h2><!-- /wp:heading --><!-- wp:woocommerce/product-new {"rows":1} /--></div><!-- /wp:woocommerce/empty-cart-block --></div><!-- /wp:woocommerce/cart -->'`,
    `post create --post_type=page --post_status=publish --post_title='Blocks checkout' --post_name='blocks-checkout' --post_content='<!-- wp:woocommerce/checkout {"align":"wide"} --><div class="wp-block-woocommerce-checkout wc-block-checkout alignwide is-loading"><!-- wp:woocommerce/checkout-fields-block --><div class="wp-block-woocommerce-checkout-fields-block"><!-- wp:woocommerce/checkout-express-payment-block --><div class="wp-block-woocommerce-checkout-express-payment-block"></div><!-- /wp:woocommerce/checkout-express-payment-block --><!-- wp:woocommerce/checkout-contact-information-block --><div class="wp-block-woocommerce-checkout-contact-information-block"></div><!-- /wp:woocommerce/checkout-contact-information-block --><!-- wp:woocommerce/checkout-shipping-address-block --><div class="wp-block-woocommerce-checkout-shipping-address-block"></div><!-- /wp:woocommerce/checkout-shipping-address-block --><!-- wp:woocommerce/checkout-billing-address-block --><div class="wp-block-woocommerce-checkout-billing-address-block"></div><!-- /wp:woocommerce/checkout-billing-address-block --><!-- wp:woocommerce/checkout-shipping-methods-block --><div class="wp-block-woocommerce-checkout-shipping-methods-block"></div><!-- /wp:woocommerce/checkout-shipping-methods-block --><!-- wp:woocommerce/checkout-payment-block --><div class="wp-block-woocommerce-checkout-payment-block"></div><!-- /wp:woocommerce/checkout-payment-block --><!-- wp:woocommerce/checkout-order-note-block --><div class="wp-block-woocommerce-checkout-order-note-block"></div><!-- /wp:woocommerce/checkout-order-note-block --><!-- wp:woocommerce/checkout-terms-block --><div class="wp-block-woocommerce-checkout-terms-block"></div><!-- /wp:woocommerce/checkout-terms-block --><!-- wp:woocommerce/checkout-actions-block --><div class="wp-block-woocommerce-checkout-actions-block"></div><!-- /wp:woocommerce/checkout-actions-block --></div><!-- /wp:woocommerce/checkout-fields-block --><!-- wp:woocommerce/checkout-totals-block --><div class="wp-block-woocommerce-checkout-totals-block"><!-- wp:woocommerce/checkout-order-summary-block --><div class="wp-block-woocommerce-checkout-order-summary-block"></div><!-- /wp:woocommerce/checkout-order-summary-block --></div><!-- /wp:woocommerce/checkout-totals-block --></div><!-- /wp:woocommerce/checkout -->'`,
  ];

  return {
    install: installCommands,
    postinstall: postInstallCommands,
  };
}
exports.fetchProvisionCommands = fetchProvisionCommands;

/**
 * Helper function to transform a value to a PHP value.
 *
 * @param {string|number|boolean} value
 *
 * @returns {string}
 */
function transformToPHPValue(value) {
  if (typeof value === "string") {
    return `'${value}'`;
  } else if (typeof value === "boolean") {
    return value ? "true" : "false";
  } else if (typeof value === "number") {
    return value.toString();
  } else {
    throw new Error(`Unsupported constant value type: ${typeof value}`);
  }
}
exports.transformToPHPValue = transformToPHPValue;

/**
 * Adds a constant to the wp-config.php file.
 *
 * @param {string} sitePath
 * @param {string} constantName
 * @param {string|number|boolean} constantValue
 */
function addConstantToConfig(sitePath, constantName, constantValue) {
  const configFile = `${sitePath}/wp-config.php`;

  try {
    const configContents = fs.readFileSync(configFile, "utf8");
    if (configContents.includes(constantName)) {
      console.log(
        `${constantName} constant already exists in ${configFile}.`.grey
      );
    } else {
      const phpValue = transformToPHPValue(constantValue);
      const constantDefinition = `define('${constantName}', ${phpValue});\n`;
      const newConfigContents = configContents.replace(
        /\n\/\*\s*That's all, stop editing! Happy publishing\.\s*\*\/\n/,
        `${constantDefinition}$&`
      );
      fs.writeFileSync(configFile, newConfigContents, "utf8");
      console.log(`- ${constantName} constant added to ${configFile}.`.grey);
    }
  } catch (error) {
    console.error(
      `Error adding ${constantName} constant to ${configFile}: ${error.stack}`
        .red
    );
  }
}
exports.addConstantToConfig = addConstantToConfig;

async function activateTheme(sitePath, theme) {
  try {
    const projects = fetchProjects();
    // If theme argument is empty or not set, create a radio list from all the project names that contain the "wp-content/themes" in the remoteDir
    if (!theme) {
      const themeProjects = projects.filter((project) =>
        project.remoteDir.includes("wp-content/themes")
      );
      const choices = themeProjects.map((project) => ({
        name: project.name,
        value: project.value,
      }));
      choices.push(new inquirer.Separator());
      choices.push({ name: "Custom", value: "custom" });
      const answers = await inquirer.prompt([
        {
          type: "list",
          name: "theme",
          message: "Select a theme to activate:",
          choices: choices,
        },
      ]);
      theme = answers.theme;
    }

    // If the user chose "Custom", prompt for the theme name
    if (theme === "custom") {
      const answer = await inquirer.prompt([
        {
          type: "input",
          name: "themeName",
          message: "Enter the name of the custom theme to activate:",
        },
      ]);
      theme = answer.themeName;
    }

    // Check if the theme is present in any of the projects and has a remoteDir under 'wp-content/themes'
    const filteredProjects = projects.filter(
      (project) =>
        project.value === theme &&
        project.remoteDir.includes("wp-content/themes")
    );
    if (filteredProjects.length === 1) {
      // project found and matches the conditions
      const project = filteredProjects[0];
      const symlinkTarget = project.remoteDir
        .replace("/srv/htdocs", sitePath)
        .replace(/\/+$/, "");
      try {
        // Create the symlink
        try {
          fs.symlinkSync(project.localDir, symlinkTarget, "dir");
          console.log(
            `- Created symlink from '${project.localDir}' to '${symlinkTarget}'...`
              .grey
          );
        } catch (error) {
          console.log(`- ${error}`.grey);
        }

        await runWPCommand(`theme activate ${theme}`, { cwd: sitePath });

        console.log(`- Activating theme '${theme}'...`.grey);
      } catch (error) {
        console.error(`Error activating theme ${theme}: ${error.message}`);
      }
    } else {
      // Install and activate the theme
      console.log(`- Installing and activating theme '${theme}'...`.grey);
      const installCommand = `theme install ${theme} --activate`;
      // execSync(installCommand, { cwd: sitePath, stdio: "inherit" });
      await runWPCommand(installCommand, { cwd: sitePath });
    }

    console.log("Done.");
  } catch (error) {
    console.error(`Error activating theme: ${error.stack}`.red);
  }
}
exports.activateTheme = activateTheme;

async function activatePlugins(sitePath, plugins) {
  try {
    const projects = fetchProjects();
    let pluginChoices = [];

    // If plugins array argument is empty, create a multichoice list from all the plugin names that contain the "wp-content/plugins" in the remoteDir
    if (!plugins || plugins.length === 0) {
      const pluginProjects = projects.filter((project) =>
        project.remoteDir.includes("wp-content/plugins")
      );
      pluginChoices = pluginProjects.map((project) => ({
        name: project.name,
        value: project.value,
      }));
    }

    // Add a custom plugin option to the list of choices
    if (pluginChoices.length) {
      pluginChoices.push(new inquirer.Separator());
    }

    pluginChoices.push({
      name: "Enter custom plugin name(s)",
      value: "custom",
    });

    // Prompt user to select plugins to activate
    const answers = await inquirer.prompt([
      {
        type: "checkbox",
        name: "plugins",
        message: "Select plugins to activate:",
        choices: pluginChoices,
      },
    ]);

    // If user selected custom plugin name(s), prompt them to enter the plugin name(s) as a comma-separated list and add them to the plugins array
    if (answers.plugins.includes("custom")) {
      const customPlugins = await inquirer.prompt([
        {
          type: "input",
          name: "plugins",
          message: "Enter custom plugin name(s), separated by commas:",
        },
      ]);
      plugins = [
        ...plugins,
        ...answers.plugins.filter((plugin) => plugin !== "custom"),
        ...customPlugins.plugins.split(",").map((plugin) => plugin.trim()),
      ];
    } else {
      plugins = [...plugins, ...answers.plugins];
    }

    // Remove duplicate plugins from the plugins array
    plugins = [...new Set(plugins)];

    // Activate or install and activate the plugins based on the conditions
    for (const plugin of plugins) {
      const filteredProjects = projects.filter(
        (project) =>
          project.value === plugin &&
          project.remoteDir.includes("wp-content/plugins")
      );
      if (filteredProjects.length === 1) {
        // project found and matches the conditions
        const project = filteredProjects[0];
        const symlinkTarget = project.remoteDir
          .replace("/srv/htdocs", sitePath)
          .replace(/\/+$/, "");
        try {
          if (plugin !== "woocommerce") {
            try {
              fs.symlinkSync(project.localDir, symlinkTarget, "dir");
              console.log(
                `- Created symlink from '${project.localDir}' to '${symlinkTarget}'...`
                  .grey
              );
            } catch (error) {
              console.log(`- ${error}`.grey);
            }
          }

          await runWPCommand(`plugin activate ${plugin}`, { cwd: sitePath });
          console.log(`- Activating plugin '${plugin}'...`.grey);
        } catch (error) {
          console.error(`Error activating plugin ${plugin}: ${error.message}`);
        }
      } else {
        // Install and activate the plugin
        console.log(`- Installing and activating plugin '${plugin}'...`.grey);
        const installCommand = `plugin install ${plugin} --activate`;
        await runWPCommand(installCommand, { cwd: sitePath });
      }
    }

    console.log("Done.");
    return plugins;
  } catch (error) {
    console.error(`Error activating plugins: ${error.stack}`.red);
  }

  return [];
}
exports.activatePlugins = activatePlugins;

async function runProvision(title, siteName, sitePath, theme, plugins) {
  const pluginsArray =
    plugins && plugins.length ? plugins.shift().split(",") : [];

  process.chdir(sitePath);

  try {
    console.log(`Making the site accessible`.blue);
    writeHostsFile(siteName);
    addWordpressHtaccess(sitePath);

    console.log(`Select PHP`.blue);
    await selectPHP(siteName);

    const commands = fetchProvisionCommands(title, siteName);

    console.log(`Installing WordPress`.blue);
    await createDatabase(siteName);

    // Run the commands to install WordPress.
    for (var i = 0; i < commands.install.length; i++) {
      console.log(
        `- Running command ${commands.install[i].substring(0, 150)}[..]`.grey
      );
      await runWPCommand(`${commands.install[i]}`, { cwd: sitePath });
    }

    console.log(`Creating symlinks`.blue);
    createSymlinks(sitePath);

    // Run the commands to postinstall WordPress.
    console.log(`Configuring WordPress`.blue);
    for (i = 0; i < commands.postinstall.length; i++) {
      console.log(
        `- Running command ${commands.postinstall[i].substring(0, 150)}[..]`
          .grey
      );
      await runWPCommand(`${commands.postinstall[i]}`, { cwd: sitePath });
    }

    addConstantToConfig(sitePath, "JETPACK_AUTOLOAD_DEV", true);

    // Setup theme and plugins.
    console.log(`Setup plugins`.blue);
    const pluginsChosen = await activatePlugins(sitePath, pluginsArray);
    if (
      pluginsChosen.includes("all-in-one-wp-migration") &&
      pluginsChosen.includes("all-in-one-wp-migration-unlimited-extension")
    ) {
      await restoreWordPressSite(siteName);

      // We need to re-activate plugins after restoring.
      console.log(`Re-Activating plugins`.blue);
      for (const plugin of pluginsChosen) {
        await runWPCommand(`plugin activate ${plugin}`, { cwd: sitePath });
        console.log(`- Activating plugin '${plugin}'...`.grey);
      }
    }
    console.log(`Setup theme`.blue);
    await activateTheme(sitePath, theme);

    // Clear the cache.
    await runWPCommand(`rewrite flush`, { cwd: sitePath });
    await reloadNginx();
  } catch (error) {
    console.error(`Error running script: ${error.stack}`.red);
  }
}
exports.runProvision = runProvision;

/**
 * Creates the htaccess file for a wordpress site.
 *
 * @param {string} siteName
 *
 * @returns boolean
 */
function addWordpressHtaccess(sitePath) {
  console.log("Adding .htaccess file".blue);
  try {
    const htaccessContent = `# BEGIN WordPress
    # The directives (lines) between "BEGIN WordPress" and "END WordPress" are
    # dynamically generated, and should only be modified via WordPress filters.
    # Any changes to the directives between these markers will be overwritten.
    <IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
    RewriteBase /
    RewriteRule ^index\.php$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.php [L]
    </IfModule>

    # END WordPress
    `;

    const htaccessFilePath = path.join(sitePath, ".htaccess");
    fs.writeFileSync(htaccessFilePath, htaccessContent);
    console.log(`- Created ${htaccessFilePath}`.grey);
    return true;
  } catch (error) {
    console.error(`Error creating .htaccess file: ${error.stack}`.red);
    return false;
  }
}
exports.addWordpressHtaccess = addWordpressHtaccess;

async function restoreWordPressSite(siteName) {
  try {
    const shouldUseWpress = await inquirer.prompt({
      type: "confirm",
      name: "useWpress",
      message: "Do you want to use a wpress file for restoration?",
    });

    if (!shouldUseWpress.useWpress) {
      console.log("Skipping WordPress restoration.");
      return;
    }

    let wpressFilePath = "";

    while (true) {
      const wpressPrompt = await inquirer.prompt({
        type: "input",
        name: "filePath",
        message: "Enter the file path containing the wpress file:",
      });

      wpressFilePath = wpressPrompt.filePath;

      if (fs.existsSync(wpressFilePath)) {
        break;
      } else {
        console.error(
          "The specified wpress file does not exist. Please provide a valid file path."
        );
      }
    }
    const sitePath = `${siteDirectory}/${siteName}`;
    const destinationPath = `${sitePath}/wp-content/ai1wm-backups/`;
    const backupFileName = "backup.wpress";
    const destinationFile = `${destinationPath}${backupFileName}`;

    if (!fs.existsSync(destinationFile)) {
      fs.mkdirSync(destinationPath, { recursive: true });
      fs.copyFileSync(wpressFilePath, destinationFile);
      console.log(`Copied wpress file to ${destinationFile}`);
    } else {
      console.log(
        `Destination file ${destinationFile} already exists. Skipping copy.`
      );
    }

    await wrapWithLoader(
      "Restoring from wpress file. This may take a while...",
      async () => {
        await runWPCommand(`ai1wm restore ${backupFileName} --yes`, {
          cwd: sitePath,
        });
      }
    );
    await wrapWithLoader("Regenerating thumbnails...", async () => {
      await runWPCommand(`media regenerate --yes`, {
        cwd: sitePath,
      });
    });
    console.log(`\nSite restored successfully.`);

    await runWPCommand(
      `wp user create ${process.env.WP_ADMIN_USER} ${process.env.WP_ADMIN_EMAIL} --role=administrator --user_pass=${process.env.WP_ADMIN_PASSWORD}`,
      { cwd: sitePath }
    );
    console.log("\nTest user added successfully.");
    console.log(`\nMigration Completed.`.blue);
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
}
exports.restoreWordPressSite = restoreWordPressSite;
