const path = require("path");

const ejs = require("ejs");

const renderTemplate = async ({ templateName, data }) => {
  const templatePath = path.join(__dirname, "templates", `${templateName}.ejs`);

  return await ejs.renderFile(templatePath, data);
};

module.exports = {
  renderTemplate,
};
