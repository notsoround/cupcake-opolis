import { PRODUCT_DISPLAY_NAME } from "../../../src/shared/brand.js";

/**
 * User-visible product brand for the Control UI. Internal identifiers, package names,
 * CLI commands (`openclaw …`) and protocol names intentionally stay "openclaw".
 * Shared with Gateway-side display strings through src/shared/brand.ts.
 */
export const BRAND_NAME = PRODUCT_DISPLAY_NAME;

/** Brand mark served from ui/public (the Cupcake mark; colors follow the pink theme). */
export const BRAND_MARK_ASSET = "favicon.svg";
