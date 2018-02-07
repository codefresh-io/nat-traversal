/* eslint-disable prefer-rest-params */
const oldConsoleLog = console.log;

function addTimestampToConsole() {
  return oldConsoleLog(...[`(${new Date().toISOString()})`].concat(Array.prototype.slice.call(arguments)));
}

console.log = addTimestampToConsole;

module.exports = {
  addTimestampToConsole,
};
