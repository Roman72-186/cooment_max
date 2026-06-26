// Виджет опроса — отображает вопрос и результаты голосования.
// Голосование происходит через кнопки под постом в MAX (callback-кнопки),
// а не через этот виджет. Виджет — только отображение результатов.

import { useEffect, useState } from 'react';
import { getPollResults } from '../api/backend';

interface PollOption {
  text: string;
  count: number;
  percent: number;
}

interface PollData {
  question: string;
  options: PollOption[];
  total_votes: number;
  voted_option: number | null;
}

interface PollWidgetProps {
  postId: number;
}

export function PollWidget({ postId }: PollWidgetProps) {
  const [poll, setPoll] = useState<PollData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getPollResults(postId).then(data => {
      if (!cancelled) {
        setPoll(data);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [postId]);

  // Не отображаем ничего пока грузим или если опроса нет
  if (loading || !poll) return null;

  const maxCount = Math.max(...poll.options.map(o => o.count), 1);

  return (
    <div className="poll-widget">
      <div className="poll-question">{poll.question}</div>
      <div className="poll-options">
        {poll.options.map((option, idx) => {
          const isVoted = poll.voted_option === idx;
          const isLeading = option.count === maxCount && option.count > 0;

          return (
            <div
              key={idx}
              className={`poll-option${isVoted ? ' poll-option--voted' : ''}`}
            >
              <div className="poll-option-header">
                <span className="poll-option-text">
                  {isVoted && <span className="poll-voted-mark">✅ </span>}
                  {option.text}
                </span>
                <span className="poll-option-stats">
                  {option.percent}% · {option.count}
                </span>
              </div>
              <div className="poll-bar-track">
                <div
                  className={`poll-bar-fill${isLeading ? ' poll-bar-fill--leading' : ''}`}
                  style={{ width: `${option.percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="poll-total">
        {poll.total_votes === 0
          ? 'Нет голосов — голосуйте под постом'
          : `${poll.total_votes} ${pluralVotes(poll.total_votes)} · голосуйте под постом`}
      </div>
    </div>
  );
}

function pluralVotes(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'голосов';
  if (mod10 === 1) return 'голос';
  if (mod10 >= 2 && mod10 <= 4) return 'голоса';
  return 'голосов';
}
