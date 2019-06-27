module.exports = {
  apps: {
    name: "kangazone-server",
    script: "./dist/index.js",
    watch: ["./dist"],
    log_date_format: "YYYY-MM-DD HH:mm:ss.SSS (ZZ)"
  }
};
