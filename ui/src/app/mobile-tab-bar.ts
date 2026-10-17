import { html } from "lit";
import { isSettingsTakeover, titleForRoute } from "../app-navigation.ts";
import { isSessionRouteId, pathForRoute, type RouteId } from "../app-route-paths.ts";
import { icons, type IconName } from "../components/icons.ts";
import { t } from "../i18n/index.ts";
import { shouldHandleNavigationClick } from "../lib/navigation-click.ts";

/**
 * Phone-width primary navigation (<=768px, see layout.mobile.css). It is a
 * layout reflow only: the drawer sidebar keeps every destination and the
 * "More" tab opens it, so nothing that the sidebar offered becomes unreachable.
 */
export type MobileTab = "chat" | "nutrition" | "receipts" | "settings";

const MOBILE_TABS: ReadonlyArray<{ id: MobileTab; route: RouteId; icon: IconName }> = [
  { id: "chat", route: "chat", icon: "messageSquare" },
  { id: "nutrition", route: "nutrition", icon: "utensils" },
  { id: "receipts", route: "receipts", icon: "receipt" },
  // The bare /settings route is the native-embed list page and redirects on the
  // web, so the tab opens the same first page as the identity menu's Settings.
  { id: "settings", route: "appearance", icon: "settings" },
];

export function activeMobileTab(routeId: RouteId): MobileTab | null {
  if (isSessionRouteId(routeId) || routeId === "new-session") {
    return "chat";
  }
  if (routeId === "nutrition" || routeId === "receipts") {
    return routeId;
  }
  if (routeId === "settings" || isSettingsTakeover(routeId)) {
    return "settings";
  }
  return null;
}

export function renderMobileTabBar(props: {
  activeRoute: RouteId;
  basePath: string;
  navDrawerOpen: boolean;
  onNavigate: (routeId: RouteId) => void;
  /** Opens the drawer sidebar; the trigger receives focus back on close. */
  onOpenMore: (trigger?: HTMLElement) => void;
}) {
  const active = activeMobileTab(props.activeRoute);
  return html`
    <nav
      class="mobile-tab-bar"
      aria-label=${t("cupcake.mobileTabs.label")}
      ?inert=${props.navDrawerOpen}
    >
      ${MOBILE_TABS.map(
        (tab) => html`
          <a
            class="mobile-tab-bar__tab ${active === tab.id ? "mobile-tab-bar__tab--active" : ""}"
            href=${pathForRoute(tab.route, props.basePath)}
            aria-current=${active === tab.id ? "page" : "false"}
            data-mobile-tab=${tab.id}
            @click=${(event: MouseEvent) => {
              if (!shouldHandleNavigationClick(event)) {
                return;
              }
              event.preventDefault();
              props.onNavigate(tab.route);
            }}
          >
            <span class="mobile-tab-bar__icon" aria-hidden="true">${icons[tab.icon]}</span>
            <span class="mobile-tab-bar__label"
              >${tab.id === "settings" ? t("nav.settings") : titleForRoute(tab.route)}</span
            >
          </a>
        `,
      )}
      <button
        type="button"
        class="mobile-tab-bar__tab ${active === null ? "mobile-tab-bar__tab--active" : ""}"
        aria-haspopup="dialog"
        aria-expanded=${String(props.navDrawerOpen)}
        data-mobile-tab="more"
        @click=${(event: MouseEvent) => props.onOpenMore(event.currentTarget as HTMLElement)}
      >
        <span class="mobile-tab-bar__icon" aria-hidden="true">${icons.moreHorizontal}</span>
        <span class="mobile-tab-bar__label">${t("nav.more")}</span>
      </button>
    </nav>
  `;
}
