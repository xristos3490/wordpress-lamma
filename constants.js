// Description: Constants used throughout the application.
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const LTD = "." + process.env.LTD;
const HOMEBREW_DIRECTORY = process.env.HOMEBREW_DIRECTORY;
exports.LTD = LTD;
exports.HOMEBREW_DIRECTORY = HOMEBREW_DIRECTORY;

const SHELL_RC_FILES = {
  bash: ".bashrc",
  zsh: ".zshrc",
  fish: ".config/fish/config.fish",
};
exports.SHELL_RC_FILES = SHELL_RC_FILES;

const HOME_DIRECTORY = process.env.HOME_DIRECTORY;
const lammaDirectory = `${HOME_DIRECTORY}/lamma`;
exports.lammaDirectory = lammaDirectory;

const logsDirectory = `${lammaDirectory}/logs`;
exports.logsDirectory = logsDirectory;

const siteDirectory = process.env.SITES_DIRECTORY;
exports.siteDirectory = siteDirectory;

const LOCAL_WOO_PATH = process.env.LOCAL_WOO_PATH;
exports.LOCAL_WOO_PATH = LOCAL_WOO_PATH;

const LOCAL_DUMMY_PATH = process.env.LOCAL_DUMMY_PATH;
exports.LOCAL_DUMMY_PATH = LOCAL_DUMMY_PATH;

const phpVersionsPath = `${HOMEBREW_DIRECTORY}/etc/php`;
exports.phpVersionsPath = phpVersionsPath;

const nginxDirectory = `${HOMEBREW_DIRECTORY}/etc/nginx`;
exports.nginxDirectory = nginxDirectory;

const nginxServersDirectory = `${nginxDirectory}/servers`;
exports.nginxServersDirectory = nginxServersDirectory;

const sslNginxDirectory = path.join(nginxDirectory, "ssl");
exports.sslNginxDirectory = sslNginxDirectory;
