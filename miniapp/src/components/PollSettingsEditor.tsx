// Редактор шаблона опроса для SettingsPage.
// Владелец канала задаёт вопрос и варианты ответа (2–5).
// Каждый новый пост в канале автоматически получит кнопки с этими вариантами.

import { useRef } from 'react';

export interface PollTemplate {
  poll_enabled: boolean;
  poll_question: string;
  poll_options: Array<{ text: string }>;
}

interface Props {
  value: PollTemplate;
  onChange: (next: PollTemplate) => void;
}

export function PollSettingsEditor({ value, onChange }: Props) {
  const { poll_enabled, poll_question, poll_options } = value;

  const handleToggle = (enabled: boolean) => {
    onChange({ ...value, poll_enabled: enabled });
  };

  const handleQuestion = (text: string) => {
    onChange({ ...value, poll_question: text });
  };

  const handleOptionChange = (idx: number, text: string) => {
    const next = poll_options.map((o, i) => i === idx ? { text } : o);
    onChange({ ...value, poll_options: next });
  };

  const handleAddOption = () => {
    if (poll_options.length >= 5) return;
    onChange({ ...value, poll_options: [...poll_options, { text: '' }] });
  };

  const handleRemoveOption = (idx: number) => {
    if (poll_options.length <= 2) return;
    onChange({ ...value, poll_options: poll_options.filter((_, i) => i !== idx) });
  };

  return (
    <div className="poll-settings">
      <label className="toggle-row">
        <div className="toggle-row__info">
          <span className="toggle-row__label">Опрос под новыми постами</span>
          <span className={`toggle-state ${poll_enabled ? 'toggle-state--on' : 'toggle-state--off'}`}>
            {poll_enabled ? 'Включено' : 'Выключено'}
          </span>
        </div>
        <input
          type="checkbox"
          className="toggle"
          checked={poll_enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
      </label>

      {poll_enabled && (
        <div className="poll-settings__body">
          <div className="poll-settings__field">
            <label className="poll-settings__label">Вопрос опроса</label>
            <textarea
              className="settings-textarea"
              placeholder="Что думаете о..."
              maxLength={200}
              rows={2}
              value={poll_question}
              onChange={(e) => handleQuestion(e.target.value)}
            />
            <div className="settings-section__hint">
              {poll_question.length} / 200
            </div>
          </div>

          <div className="poll-settings__field">
            <label className="poll-settings__label">
              Варианты ответа ({poll_options.length} / 5)
            </label>
            <div className="poll-options-list">
              {poll_options.map((opt, idx) => (
                <div key={idx} className="poll-option-row">
                  <input
                    type="text"
                    className="poll-option-input"
                    placeholder={`Вариант ${idx + 1}`}
                    maxLength={50}
                    value={opt.text}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                  />
                  <button
                    type="button"
                    className="poll-option-remove"
                    onClick={() => handleRemoveOption(idx)}
                    disabled={poll_options.length <= 2}
                    aria-label="Удалить вариант"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {poll_options.length < 5 && (
              <button
                type="button"
                className="poll-add-btn"
                onClick={handleAddOption}
              >
                + Добавить вариант
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
