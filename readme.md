![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![WordPress](https://img.shields.io/badge/WordPress-%23117AC9.svg?style=for-the-badge&logo=WordPress&logoColor=white)
![Nginx](https://img.shields.io/badge/nginx-009639?style=for-the-badge&logo=nginx&logoColor=white)


# Lamma - WordPress Local Development CLI

Lamma is a versatile command-line interface (CLI) tool designed for effortless WordPress site management on your local machine. With its lightweight and flexible features tailored to the Nginx server, Lamma simplifies site creation, theme and plugin management, and site removal tasks.

## Prerequisites

Before harnessing the power of Lamma, ensure that the following software is installed on your system:

- **Node.js v16**: Lamma relies on Node.js, so you'll need version 16 or newer. Download it from nodejs.org.

- **Homebrew**: You can streamline package installations with Homebrew. To get Homebrew, open your terminal and execute this command:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- **MySQL or MariaDB**: Ensure that MySQL or MariaDB is installed and running as a service with Homebrew. If not, please follow the steps [here](https://github.com/xristos3490/wordpress-lamma).

## Usage

Lamma boasts an array of commands that you can invoke using the `lamma` command, followed by your desired action. Here's a summary of the available commands:

### `lamma sites [--all]`

List all configured sites. Use the `--all` option for a more detailed listing.

### `lamma info <name>`

Retrieve information about a specific site by providing its name.

### `lamma add --name <name> [--title <title>] [--theme <theme>] [--plugins <plugins>]`

Create a new site with customizable options:
- `--name`: The name of the new site (required).
- `--title`: The title of the new site (optional).
- `--theme`: The ID of the theme to use (optional).
- `--plugins`: A comma-separated list of plugin IDs to use (optional).

### `lamma remove <name>`

Remove a site by providing its name as an argument.

### `lamma logs <name>`

Display logs for a specific site.

### `lamma php-change <name> <phpVersion>`

Change the PHP version of a specific site.
- Provide the site's name and the desired PHP version as arguments.

### `lamma wp <name>`

WP CLI alias for a specific site.


### `lamma add-plugins <name>`

Add a symlink to a plugin within the site's plugins directory.

### `lamma unmanage-plugins <name>`

Remove a symlink to a plugin by copying the plugin's files to the site's plugins directory.

### `lamma switch-theme <name>`

Change the theme of a specific site.

### `lamma server <action>`

Manage the Nginx server with the following actions:

- `install`: Install Nginx.
- `status`: Check the status of the Nginx server.
- `reload`: Reload the Nginx configuration.
- `php`: Check the PHP status.

### `lamma hosts-doctor`

Fix the hosts file for all configured sites.

### `lamma php-doctor`

Assign distinct port numbers to PHP-FPM versions and set the process owner to the current user. Be cautious, as it may interrupt existing PHP connections.

### Additional Options

- `--help` (`-h`): Display help information for the script and its commands.
- `--version` (`-v`): Display the script's version information.

### Managing Projects

Lamma can search for themes and plugins in the `~/.woa_projects.json` file, a JSON file listing all your projects. This file should be in your home directory (`~/`). Here's a sample:

```json
[
  {
    "name": "Project 1",
    "value": "project1",
    "args": [
      "--exclude",
      ".git",
      "--exclude",
      ".cache",
      "--exclude",
      "node_modules/",
      "--exclude",
      "tests/"
    ],
    "localDir": "/path/to/project1",
    "remoteDir": "/path/to/remote/project1"
  },
  {
    "name": "Project 2",
    "value": "project2",
    "args": [
      "--exclude",
      ".git",
      "--exclude",
      ".cache",
      "--exclude",
      "node_modules/",
      "--exclude",
      "tests/"
    ],
    "localDir": "/path/to/project2",
    "remoteDir": "/path/to/remote/project2"
  }
]
```

Each project is defined with the following properties:

- `name`: The project's name.
- `value`: A unique identifier.
- `args`: An array of rsync arguments for project syncing.
- `localDir`: The local directory where the project resides.
- `remoteDir`: The remote directory for project syncing.

By maintaining your projects in `woa_projects.json`, you can effortlessly manage themes and plugins across all your projects with Lamma.

## Installation

To install Lamma, follow these steps:

1. Clone the repository to your local machine.
2. Navigate to the cloned directory.
3. Run npm install to install dependencies.
4. Copy the `env.sample` file to `.env` and fill it in with your specific details.
5. Run npm run setup to configure the tool.
6. _(Optional)_ Create `~/.woa_projects.json` with your project list (refer to the example in the Usage section). Ensure that you avoid trailing commas in your JSON objects or properties.
7. _(Optional)_ Run the source command as described to update the shell.

### Install and Start MySQL with Homebrew

- If you haven't already installed MySQL, you can do so using Homebrew. Open your terminal and run the following command:

```bash
brew install mysql
```
- After the installation is complete, start the MySQL service with the following command:

```bash
brew services start mysql
```
This will ensure that MySQL runs as a background service, and it will start automatically whenever you boot your computer.

#### Set a Default Root Password

- Access MySQL: To access MySQL, open your terminal and run the following command:

```bash
mysql -u root
```
You may be prompted to enter your password. If you haven't set a password yet, just press Enter (leave it blank) for now.

- Once you are in the MySQL shell, use the following SQL command to set the root user's password to 'root' (you can replace 'root' with your desired password):

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
```

- Exit the MySQL shell by typing:

```sql
exit;
```

Now, you have MySQL installed and running as a service with Homebrew, and the root user's password has been set to 'root'. Be sure to secure your database by using a strong and secure password in production environments.

## License

This project is licensed under the MIT License. For more details, see the [LICENSE](LICENSE) file.

## Acknowledgments

Lamma is maintained by the dedicated Lamma development team. We welcome contributions and invite you to explore the project on [GitHub](https://github.com/your-repo-link).

For questions, issues, or support, please visit the [GitHub repository](https://github.com/your-repo-link) or reach out to us at [your-contact-email@example.com](mailto:your-contact-email@example.com).
