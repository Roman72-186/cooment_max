// Список комментариев с вложенными ответами
import type { Comment } from '../api/backend';
import { CommentCard } from './CommentCard';

interface Props {
  comments: Comment[];
  onDeleted?: (id: number) => void;
}

// Превращает плоский список в дерево (верхний уровень + replies)
function buildTree(flat: Comment[]): Comment[] {
  const map = new Map<number, Comment>();
  const roots: Comment[] = [];

  // Инициализируем все узлы с пустыми replies
  flat.forEach((c) => map.set(c.id, { ...c, replies: [] }));

  map.forEach((c) => {
    if (c.parent_id === null) {
      roots.push(c);
    } else {
      const parent = map.get(c.parent_id);
      if (parent) {
        parent.replies!.push(c);
      } else {
        roots.push(c);
      }
    }
  });

  return roots;
}

export function CommentThread({ comments, onDeleted }: Props) {
  const tree = buildTree(comments);

  if (tree.length === 0) {
    return (
      <div className="empty-state">
        <span>Пока нет комментариев</span>
        <span>Будьте первым!</span>
      </div>
    );
  }

  return (
    <div className="comment-thread">
      {tree.map((comment) => (
        <CommentCard key={comment.id} comment={comment} depth={0} onDeleted={onDeleted} />
      ))}
    </div>
  );
}
