import {
  MAX_BOARD_TITLE_LENGTH,
  normalizeBoardTitle,
  parseBoardExpiry,
  updateShareBoard,
} from "./share-board";
import { ShareBoardError } from "./share-board-errors";
import {
  generateSharePasscode,
  hashSharePassword,
  isValidSharePasscode,
} from "./report-share";
import { encryptSharePasscode } from "./share-credentials";

type ShareBoardSettingsInput = {
  title?: unknown;
  regeneratePassword?: unknown;
  password?: unknown;
  expiresOn?: unknown;
  disabled?: unknown;
};

/** 校验并更新属主侧分享面板设置，返回本次生成或清除的提取码。 */
export async function updateShareBoardSettings(input: {
  userId: string;
  boardId: string;
  settings: ShareBoardSettingsInput;
}): Promise<{ passcode: string | null | undefined }> {
  const changes: {
    title?: string;
    passwordHash?: string | null;
    passwordEnc?: string | null;
    disabled?: boolean;
    expiresAt?: Date | null;
  } = {};

  if (input.settings.title !== undefined) {
    const title = normalizeBoardTitle(input.settings.title);
    if (!title) {
      throw new ShareBoardError("BOARD_TITLE_INVALID", {
        max: MAX_BOARD_TITLE_LENGTH,
      });
    }
    changes.title = title;
  }

  let passcode: string | null | undefined;
  if (input.settings.regeneratePassword === true) {
    passcode = generateSharePasscode();
    changes.passwordHash = await hashSharePassword(passcode);
    changes.passwordEnc = encryptSharePasscode(passcode);
  } else if (input.settings.password !== undefined) {
    if (input.settings.password === null || input.settings.password === "") {
      changes.passwordHash = null;
      changes.passwordEnc = null;
      passcode = null;
    } else if (typeof input.settings.password === "string") {
      const password = input.settings.password.trim().toUpperCase();
      if (!isValidSharePasscode(password)) {
        throw new ShareBoardError("BOARD_PASSCODE_INVALID");
      }
      changes.passwordHash = await hashSharePassword(password);
      changes.passwordEnc = encryptSharePasscode(password);
      passcode = password;
    } else {
      throw new ShareBoardError("BOARD_PASSWORD_SETTING_INVALID");
    }
  }

  if (input.settings.expiresOn !== undefined) {
    const expiresAt = parseBoardExpiry(input.settings.expiresOn);
    if (expiresAt === "invalid") {
      throw new ShareBoardError("BOARD_EXPIRY_INVALID");
    }
    changes.expiresAt = expiresAt;
  }
  if (input.settings.disabled !== undefined) {
    if (typeof input.settings.disabled !== "boolean") {
      throw new ShareBoardError("BOARD_DISABLED_INVALID");
    }
    changes.disabled = input.settings.disabled;
  }
  if (Object.keys(changes).length === 0) {
    throw new ShareBoardError("BOARD_NO_CHANGES");
  }

  await updateShareBoard(input.userId, input.boardId, changes);
  return { passcode };
}
