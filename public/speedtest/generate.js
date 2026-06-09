const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SIZE_MB = 100;
const FILE_PATH = path.join(__dirname, "100mb.bin");

console.log(`Generating ${SIZE_MB}MB test file...`);

const writeStream = fs.createWriteStream(FILE_PATH);
const chunkSize = 1024 * 1024;
let written = 0;

function writeChunk() {
  let ok = true;
  while (ok && written < SIZE_MB) {
    const chunk = crypto.randomBytes(chunkSize);
    ok = writeStream.write(chunk);
    written++;
    if (written % 10 === 0) {
      process.stdout.write(`\r${written}MB / ${SIZE_MB}MB`);
    }
  }
  if (written < SIZE_MB) {
    writeStream.once("drain", writeChunk);
  } else {
    writeStream.end();
    process.stdout.write(`\r${SIZE_MB}MB / ${SIZE_MB}MB\nDone!\n`);
  }
}

writeChunk();
