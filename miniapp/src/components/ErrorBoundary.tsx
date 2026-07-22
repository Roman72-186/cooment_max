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
        <div className="page page--center">
          <div className="error-state" role="alert">
            <span className="error-state__icon" aria-hidden="true">⚠️</span>
            <span>Что-то пошло не так.<br />Попробуйте перезагрузить приложение.</span>
            <button onClick={() => window.location.reload()}>Обновить</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
