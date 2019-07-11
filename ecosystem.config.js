module.exports = {
  apps: {
    name: "kangazone-server",
    script: "./dist/index.js",
    log_date_format: "YYYY-MM-DD HH:mm:ss.SSS (ZZ)"
  },
  deploy: {
    production: {
      user: "www-data",
      host: ["stirad.com"],
      ref: "origin/master",
      repo: "https://github.com/uicestone/kangazone-server",
      path: "/var/www/kangazone-server",
      "post-deploy": "yarn && pm2 startOrRestart ecosystem.config.js"
    }
  }
};
