// Copied from main: main has this module only at the repository root
// (index-path.js), while B.Parser/host/_index.js and B.Parser/_index.js
// resolve it as B.Parser/index-path.js. Re-export the root module here so
// there is still exactly one implementation.
export * from "../index-path.js";
import rootIndexPath from "../index-path.js";

export default rootIndexPath;
