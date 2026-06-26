// Типизированная обёртка над window.WebApp (MAX Bridge)

interface MaxUser {
  id?: number;        // реальное поле MAX/Telegram
  user_id?: number;   // алиас (на случай других версий bridge)
  first_name?: string;
  last_name?: string;
  name?: string;
  username?: string;
  is_bot?: boolean;
}

interface MaxWebApp {
  initData: string;
  initDataUnsafe: {
    user?: MaxUser;
    start_param?: string;
    hash?: string;
  };
  ready(): void;
  expand(): void;
  close(): void;
  openLink(url: string): void;
  shareMaxContent?(content: { text?: string; link?: string }): void;
  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback: (confirmed: boolean) => void): void;
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

// Получить текущего пользователя из Bridge
export function getBridgeUser(): MaxUser | null {
  return window.WebApp?.initDataUnsafe?.user ?? null;
}

// Получить стартовый параметр (например "post_42")
// MAX передаёт через URL ?startapp= ИЛИ через initDataUnsafe.start_param
export function getStartParam(): string | null {
  const urlParam = new URLSearchParams(window.location.search).get('startapp');
  return urlParam ?? window.WebApp?.initDataUnsafe?.start_param ?? null;
}

// Получить подписанные данные для верификации на сервере
export function getInitData(): string {
  return window.WebApp?.initData ?? '';
}

// Сообщить MAX, что приложение загрузилось (скрывает спиннер)
export function notifyReady(): void {
  window.WebApp?.ready();
}

// Развернуть на весь экран (expand может отсутствовать в MAX)
export function expand(): void {
  window.WebApp?.expand?.();
}

export function showAlert(message: string): void {
  if (window.WebApp?.showAlert) {
    window.WebApp.showAlert(message);
    return;
  }
  console.info(message);
}

export async function shareReferralLink(link: string, text: string): Promise<'shared' | 'copied'> {
  if (window.WebApp?.shareMaxContent) {
    window.WebApp.shareMaxContent({ text, link });
    return 'shared';
  }

  if (navigator.share) {
    await navigator.share({ title: 'Комментарии в ПОСТ', text, url: link });
    return 'shared';
  }

  await navigator.clipboard.writeText(link);
  return 'copied';
}
