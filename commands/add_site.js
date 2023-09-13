// async function handleAddCommand(siteName, theme, plugins, title) {
//     const sitePath = path.join(siteDirectory, siteName);

//     // Check if the site name already exists
//     if (fs.existsSync(`${sitesAvailableDirectory}/${siteName}.conf`)) {
//         console.log(`Virtual host for ${siteName}${LTD} already exists`);
//         process.exit(1);
//     }

//     // Check if the site directory already exists
//     if (fs.existsSync(sitePath)) {
//         console.error(`The site directory ${sitePath} already exists.`);
//         process.exit(1);
//     }

//     // Create the site directory
//     fs.mkdirSync(sitePath);

//     // Setup server.
//     console.log("Configuring server".blue);
//     createApacheSSL(siteName);
//     setupApacheConfig(siteName, sitePath);
//     installWPCLI();

//     runProvision(title, siteName, sitePath, theme, plugins)
//         .then(() => {
//             console.log(
//                 `\nTask completed successfully.`.green +
//                 ` \n\nYou new site is available at https://${siteName}.test\nDocument root is at: ${sitePath}\n\nHappy coding! :)`
//                     .green
//             );
//         })
//         .catch((error) => {
//             console.error(`\nTask failed: ${error.stack}`.red);
//         });
// }
