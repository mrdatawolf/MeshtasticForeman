import css from "./configStyles.module.css";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const styles = {
  page: css.page,
  deviceBar: css.deviceBar,
  empty: css.empty,
  body: css.pageBody,
  section: css.section,
  sectionTitle: css.sectionTitle,
  cardGrid: css.cardGrid,
  cardHeader: css.cardHeader,
  cardBody: css.cardBody,
  rowKey: css.rowKey,
  rowVal: css.rowVal,
  disabledPill: css.disabledPill,
  editBtn: css.editBtn,
  cancelBtn: css.cancelBtn,
  inputText: css.inputText,
  inputNum: css.inputNum,
  wizardBar: css.wizardBar,
  wizardBarTitle: css.wizardBarTitle,
  wizardBarSub: css.wizardBarSub,
};

export const wizardStyles = {
  overlay: css.overlay,
  modal: css.modal,
  header: css.header,
  closeBtn: css.closeBtn,
  stepPip: css.stepPip,
  body: css.wizardBody,
  step: css.step,
  stepTitle: css.stepTitle,
  stepSub: css.stepSub,
  nav: css.nav,
  stepEmpty: css.stepEmpty,
  breadcrumbs: css.breadcrumbs,
  selectionHint: css.selectionHint,
};

export function namespacePillClass(ns: "radio" | "module"): string {
  return cx(css.namespacePill, ns === "radio" && css.namespacePillRadio);
}

export function configCardClass(active: boolean): string {
  return cx(css.configCard, !active && css.configCardInactive);
}

export function channelCardClass(primary: boolean): string {
  return cx(css.channelCard, primary && css.channelCardPrimary);
}

export function rowClass(inDraft: boolean): string {
  return cx(css.row, inDraft && css.rowInDraft);
}

export function deviceBtnClass(active: boolean, connected: boolean): string {
  return cx(
    css.deviceBtn,
    active && css.deviceBtnActive,
    connected ? css.deviceBtnConnected : css.deviceBtnDisconnected,
  );
}

export function navBtnClass(disabled: boolean): string {
  return cx(css.navBtn, disabled && css.navBtnDisabled);
}

export function applyBtnClass(disabled: boolean): string {
  return cx(css.applyBtn, disabled && css.applyBtnDisabled);
}

export function saveBtnClass(disabled: boolean): string {
  return cx(css.saveBtn, disabled && css.saveBtnDisabled);
}

export function wizardLaunchBtnClass(enabled: boolean): string {
  return cx(css.wizardLaunchBtn, enabled && css.wizardLaunchBtnEnabled);
}

export function toggleBtnClass(on: boolean): string {
  return cx(css.toggleBtn, on && css.toggleBtnOn);
}

export function wizardRoleBtnClass(active: boolean): string {
  return cx(css.wizardRoleBtn, active && css.wizardRoleBtnActive);
}

export function wizardRegionBtnClass(active: boolean, child = false): string {
  return cx(
    css.wizardRegionBtn,
    !active && child && css.wizardRegionBtnChild,
    active && css.wizardRegionBtnActive,
  );
}

export function wizardBreadcrumbBtnClass(active: boolean): string {
  return cx(css.wizardBreadcrumbBtn, active && css.wizardBreadcrumbBtnActive);
}

export function featureBlockClass(active: boolean): string {
  return cx(css.featureBlock, active && css.featureBlockActive);
}
