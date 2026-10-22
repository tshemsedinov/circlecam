'use strict';

const fail = (error) => {
  const message = error.message ?? `${error}`;
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

module.exports = { fail };
