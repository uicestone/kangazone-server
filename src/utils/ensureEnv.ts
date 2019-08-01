import env from "dotenv";

export default () => {
  env.config();
  if (!process.env.REQUIRED_ENTRIES) {
    console.error(`Missing config REQUIRED_ENTRIES in .env file.`);
    process.exit();
  }
  const requiredEntries = process.env.REQUIRED_ENTRIES.split(",");
  const missingEntries = requiredEntries.filter(entry => {
    return process.env[entry] === undefined;
  });

  if (missingEntries.length) {
    console.error(`Missing config ${missingEntries.join(",")} in .env file.`);
    process.exit;
  }
};
