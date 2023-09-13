const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const spinners = require("cli-spinners");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
colors.enable();

module.exports = function removeSite(site) {
  async function deleteDatabase() {
    return new Promise((resolve, reject) => {
      const command = `mysql -u${process.env.DB_USER} -p${process.env.DB_PASSWORD} -e "DROP DATABASE IF EXISTS ${site.database};"`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async function removeHostsRecord() {
    return new Promise((resolve, reject) => {
      const hostsFilePath = "/etc/hosts";
      const LTD = ".test";
      const hostsFile = fs.readFileSync(hostsFilePath, "utf-8");

      if (hostsFile.includes(`${site.name}${LTD}`)) {
        const tempHostsFile = path.join(__dirname, "temp_hosts");
        const regex = new RegExp(
          `# Lamma: ${site.name}${LTD} START[\\s\\S]*?# Lamma ${site.name}${LTD} STOP`,
          "g"
        );
        const newData = hostsFile.replace(regex, "");
        fs.writeFileSync(tempHostsFile, `${newData}`);
        execSync(`sudo sh -c 'cat "${tempHostsFile}" > "${hostsFilePath}"'`);
        fs.unlinkSync(tempHostsFile);
      }

      resolve();
    });
  }

  async function deleteSiteDirectory() {
    return new Promise((resolve, reject) => {
      fs.rm(site.directory, { recursive: true }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async function deleteConfigFile() {
    return new Promise((resolve, reject) => {
      fs.unlink(site.configFile, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async function deleteSslCrt() {
    return new Promise((resolve, reject) => {
      fs.unlink(site.sslCrt, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async function deleteSslKey() {
    return new Promise((resolve, reject) => {
      fs.unlink(site.sslKey, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async function run() {
    try {
      const spinner = {
        frames: spinners.dots.frames,
        interval: spinners.dots.interval,
        text: `Deleting site '${site.name}'...`,
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

      try {
        // Delete database
        spinner.text = `- Delete database`;
        await deleteDatabase();

        // Remove hosts record
        spinner.text = `- Remove hosts record`;
        await removeHostsRecord();

        // Delete site directory
        spinner.text = `- Delete site directory`;
        await deleteSiteDirectory();

        // Delete apache2 configurations
        spinner.text = `- Delete site configuration`;
        await deleteConfigFile();

        spinner.text = `- Delete SSL certificates`;
        await deleteSslKey();
        await deleteSslCrt();
        console.log(`\nSite ${site.name} removed.`.green);
      } catch (error) {
        console.log(`\n${error}`.red);
      } finally {
        clearInterval(loader);
        process.stdout.write("\r\x1b[K");
      }
    } catch (error) {
      if (loader) {
        clearInterval(loader);
        process.stdout.write("\r\x1b[K");
      }
      console.error(`Error removing site ${site.name}: ${error.stack}`.red);
    }
  }

  run();
};
