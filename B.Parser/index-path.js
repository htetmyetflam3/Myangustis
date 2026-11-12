/*
(Support 3) Shared support, no chain position - a re-export shim.
This module re-exports the repository root's index-path.js so B.Parser importers share exactly one implementation of the path helpers.
*/
// Copied from main: main has this module only at the repository root
// (index-path.js), while B.Parser/public/_index.js and B.Parser/_index.js
// resolve it as B.Parser/index-path.js. Re-export the root module here so
// there is still exactly one implementation.
export * from "../index-path.js";
import rootIndexPath from "../index-path.js";

export default rootIndexPath;
