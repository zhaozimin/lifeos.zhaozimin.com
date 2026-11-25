/**
 * [INPUT]: 依赖工作台 Modal/Button/TextInput/TextArea 原语、灵感模型与现有两层标签树。
 * [OUTPUT]: 对外提供 InspirationEditorModal，支持网页新建与乐观锁编辑灵感及两层标签。
 * [POS]: 灵感记录的表单弹层边界；正文不自动改写，标签严格限制为概念大类与具体分类两层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Modal } from "./dashboard/components/ui/Modal";
import { Button } from "./dashboard/components/ui/Button";
import { TextArea, TextInput } from "./dashboard/components/ui/TextInput";
import type { Api } from "./Auth";
import type {
  InspirationRow,
  InspirationTagGroup,
  InspirationTagPair,
} from "./inspiration-model";

interface Props {
  open: boolean;
  target: InspirationRow | null;
  tagTree: InspirationTagGroup[];
  api: Api;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function InspirationEditorModal({
  open,
  target,
  tagTree,
  api,
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [tags, setTags] = useState<InspirationTagPair[]>([]);
  const [groupInput, setGroupInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (target) {
      setTitle(target.title ?? "");
      setSummary(target.summary ?? "");
      setContent(target.content);
      setPinned(target.pinned);
      setTags(target.tags.map((t) => ({ group: t.group, name: t.name })));
    } else {
      setTitle("");
      setSummary("");
      setContent("");
      setPinned(false);
      setTags([]);
    }
    setGroupInput("");
    setNameInput("");
  }, [open, target]);

  const suggestedChildren = useMemo(() => {
    const matched = tagTree.find(
      (g) => g.name.toLowerCase() === groupInput.trim().toLowerCase(),
    );
    return matched?.children.map((c) => c.name) ?? [];
  }, [tagTree, groupInput]);

  const addTag = () => {
    const group = groupInput.trim();
    const name = nameInput.trim();
    if (!group || !name) {
      setError("请同时填写第一层级「概念大类」与第二层级「具体分类」。");
      return;
    }
    if (group.includes("/") || name.includes("/")) {
      setError("标签名称不能包含斜杠「/」，体系严格保持两层。");
      return;
    }
    if (tags.length >= 8) {
      setError("单条灵感最多添加 8 个两层标签。");
      return;
    }
    const exists = tags.some(
      (t) =>
        t.group.toLowerCase() === group.toLowerCase() &&
        t.name.toLowerCase() === name.toLowerCase(),
    );
    if (!exists) setTags([...tags, { group, name }]);
    setNameInput("");
    setError("");
  };

  const removeTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!content.trim()) {
      setError("灵感正文不能为空。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const cleanTitle = title.trim() || null;
      const cleanSummary = summary.trim() || null;
      if (target) {
        await api("/api/inspirations/edit", {
          id: target.id,
          revision: target.revision,
          patch: {
            title: cleanTitle,
            summary: cleanSummary,
            content,
            pinned,
            tags,
          },
        });
        onSaved("灵感已更新");
      } else {
        await api("/api/inspirations/create", {
          title: cleanTitle,
          summary: cleanSummary,
          content,
          pinned,
          tags,
        });
        onSaved("灵感已保存");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={target ? "编辑灵感记录" : "新建灵感记录"}
      description="正文保留原话不自动提炼；短标题、总结与两层标签（概念大类 / 具体分类）独立维护。"
      error={error}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {target ? "保存修改" : "存入灵感记录"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="短标题（可选）"
          type="text"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：长期记忆与灵感资产化"
        />

        <TextArea
          label="内容总结（可选，与正文隔离）"
          rows={2}
          maxLength={500}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="1–2 句概括核心观点，不影响下方原文"
          className="min-h-[60px]"
        />

        <TextArea
          label="正文原文（完整保留）"
          rows={6}
          maxLength={10000}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="输入成段文字、想法或摘录……"
          className="min-h-[140px] leading-6"
        />

        <div className="grid gap-2">
          <span className="field-label !mb-0">
            两层标签（第一层级：概念大类 / 第二层级：具体分类）
          </span>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag, index) => (
                <span
                  key={`${tag.group}/${tag.name}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-zzm-fill px-2 py-1 text-xs text-foreground"
                >
                  <span className="text-muted-foreground">{tag.group}</span>
                  <span className="text-zzm-muted">/</span>
                  <span className="font-medium">{tag.name}</span>
                  <button
                    type="button"
                    aria-label={`移除标签 ${tag.group}/${tag.name}`}
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => removeTag(index)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <TextInput
              type="text"
              list="inspiration-l1-groups"
              maxLength={40}
              value={groupInput}
              onChange={(e) => setGroupInput(e.target.value)}
              placeholder="一级概念大类（如 AI、产品）"
            />
            <TextInput
              type="text"
              list="inspiration-l2-names"
              maxLength={40}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="二级具体分类（如 记忆系统）"
            />
            <Button
              variant="secondary"
              leading={<Plus size={14} />}
              onClick={addTag}
            >
              添加
            </Button>
          </div>
          <datalist id="inspiration-l1-groups">
            {tagTree.map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
          <datalist id="inspiration-l2-names">
            {suggestedChildren.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-4 w-4 accent-[var(--zzm-accent)]"
          />
          置顶这条灵感记录
        </label>
      </div>
    </Modal>
  );
}
