// Error Boundary — перехватывает необработанные ошибки React-дерева
// Показывает экран восстановления вместо белого экрана
import React from 'react';

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'ErrorBoundary: необработанная ошибка React',
      error: error.message,
      componentStack: info.componentStack,
    }));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <p style={{ color: 'var(--text-secondary)', margin: '12px 0' }}>
            Что-то пошло не так.<br />Попробуйте перезагрузить приложение.
          </p>
          <button
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            Обновить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
