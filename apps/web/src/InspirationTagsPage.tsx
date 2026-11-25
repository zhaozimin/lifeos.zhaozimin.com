/**
 * [INPUT]: 依赖 /api/inspirations 与 /api/inspirations/tags 本人 AAL2 接口及工作台 Modal/AlertDialog/TextInput 原语。
 * [OUTPUT]: 对外提供严格两层标签管理页（概念性大类 / 具体分类内容）的新建、改名、移动、合并与归档。
 * [POS]: 灵感领域标签治理页；数据库与界面双重守住「只允许两层」架构约束。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRightLeft,
  FolderPlus,
  GitMerge,
  PenLine,
  Plus,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "./dashboard/components/ui/PageHeader";
import { Button } from "./dashboard/components/ui/Button";
import { Badge } from "./dashboard/components/ui/Badge";
import { Modal } from "./dashboard/components/ui/Modal";
import { AlertDialog } from "./dashboard/components/ui/AlertDialog";
import { TextInput } from "./dashboard/components/ui/TextInput";
import { useRefreshSignal } from "./dashboard/components/Layout";
import type { Api } from "./Auth";
import type {
  InspirationsPageData,
  InspirationTagChild,
  InspirationTagGroup,
} from "./inspiration-model";

type ModalMode =
  | { kind: "create_group" }
  | { kind: "create_tag"; group: InspirationTagGroup }
  | { kind: "rename"; level: 1 | 2; id: string; name: string; description: string | null }
  | { kind: "move"; child: InspirationTagChild; currentGroupName: string }
  | { kind: "merge_group"; group: InspirationTagGroup }
  | { kind: "merge_tag"; child: InspirationTagChild; groupName: string }
  | null;

export function InspirationTagsPage({ api }: { api: Api }) {
  const refresh = useRefreshSignal();
  const [tree, setTree] = useState<InspirationTagGroup[] | null>(null);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [revision, setRevision] = useState(0);

  const [modal, setModal] = useState<ModalMode>(null);
  const [nameInput, setNameInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  const [archiving, setArchiving] = useState<{
    level: 1 | 2;
    id: string;
    label: string;
  } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<InspirationsPageData>("/api/inspirations?page=0", undefined, controller.signal)
      .then((res) => setTree(res.tagTree))
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "读取标签体系失败");
        }
      });
    return () => controller.abort();
  }, [api, revision, refresh]);

  const allLevel2 = useMemo(() => {
    if (!tree) return [];
    return tree.flatMap((g) =>
      g.children.map((c) => ({ ...c, groupName: g.name })),
    );
  }, [tree]);

  const openModal = (next: ModalMode) => {
    setModal(next);
    setModalError("");
    if (!next) return;
    if (next.kind === "create_group" || next.kind === "create_tag") {
      setNameInput("");
      setDescInput("");
    } else if (next.kind === "rename") {
      setNameInput(next.name);
      setDescInput(next.description ?? "");
    } else if (next.kind === "move") {
      const firstOther = (tree ?? []).find((g) => g.id !== next.child.parent_id);
      setTargetId(firstOther?.id ?? "");
    } else if (next.kind === "merge_group") {
      const firstOther = (tree ?? []).find((g) => g.id !== next.group.id);
      setTargetId(firstOther?.id ?? "");
    } else if (next.kind === "merge_tag") {
      const firstOther = allLevel2.find((c) => c.id !== next.child.id);
      setTargetId(firstOther?.id ?? "");
    }
  };

  const submitModal = async () => {
    if (!modal) return;
    setBusy(true);
    setModalError("");
    try {
      if (modal.kind === "create_group") {
        await api("/api/inspirations/tags", {
          action: "create_group",
          payload: { name: nameInput.trim(), description: descInput.trim() || null },
        });
        setStatusMsg("已创建概念大类");
      } else if (modal.kind === "create_tag") {
        await api("/api/inspirations/tags", {
          action: "create_tag",
          payload: {
            parent_id: modal.group.id,
            name: nameInput.trim(),
            description: descInput.trim() || null,
          },
        });
        setStatusMsg("已添加二级具体分类");
      } else if (modal.kind === "rename") {
        await api("/api/inspirations/tags", {
          action: "rename",
          payload: {
            id: modal.id,
            name: nameInput.trim(),
            description: descInput.trim() || null,
          },
        });
        setStatusMsg("标签名称已更新");
      } else if (modal.kind === "move") {
        await api("/api/inspirations/tags", {
          action: "move",
          payload: { id: modal.child.id, parent_id: targetId },
        });
        setStatusMsg("已移动所属概念大类");
      } else if (modal.kind === "merge_group" || modal.kind === "merge_tag") {
        const sourceId = modal.kind === "merge_group" ? modal.group.id : modal.child.id;
        await api("/api/inspirations/tags", {
          action: "merge",
          payload: { source_id: sourceId, target_id: targetId },
        });
        setStatusMsg("标签已合并并自动整理关联");
      }
      setModal(null);
      setRevision((v) => v + 1);
    } catch (caught) {
      setModalError(caught instanceof Error ? caught.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    setArchiveBusy(true);
    setArchiveError("");
    try {
      await api("/api/inspirations/tags", {
        action: "archive",
        payload: { id: archiving.id },
      });
      setArchiving(null);
      setStatusMsg(`已归档「${archiving.label}」`);
      setRevision((v) => v + 1);
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : "归档失败，请重试");
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <section className="grid gap-5 pb-10">
      <PageHeader
        label="Notes · Taxonomy"
        title="两层标签管理"
        note="第一层级：概念性大类 · 第二层级：具体分类内容（Agent 亦会复用并自治维护此体系）"
        actions={
          <Button
            variant="primary"
            size="sm"
            leading={<FolderPlus size={14} strokeWidth={1.5} />}
            onClick={() => openModal({ kind: "create_group" })}
          >
            新建概念大类
          </Button>
        }
      />

      {statusMsg && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-border bg-zzm-fill px-3.5 py-2 text-[13px] text-zzm-ok"
        >
          <span>{statusMsg}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setStatusMsg("")}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-zzm-accent-ink">
          {error}
        </p>
      )}

      {!tree ? (
        <div className="zzm-skel h-48 rounded-xl" />
      ) : tree.length === 0 ? (
        <div className="zzm-card grid place-items-center gap-2 py-14 text-center">
          <Tags size={24} strokeWidth={1.5} className="text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">还没有建立两层标签</p>
          <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
            你可以先手动创建概念大类与具体分类，或直接发灵感给微信 Agent，由它按两层结构自动沉淀。
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {tree.map((group) => (
            <section key={group.id} className="zzm-card grid gap-4 p-5">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="outline" uppercase>
                      L1 概念大类
                    </Badge>
                    <Link
                      to={`/inspirations?group_id=${group.id}`}
                      className="text-[16px] font-bold text-[var(--zzm-ink-strong)] hover:underline"
                    >
                      {group.name}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {group.count} 条灵感 · {group.children.length} 个子类
                    </span>
                  </div>
                  {group.description && (
                    <p className="text-[13px] text-muted-foreground">
                      {group.description}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    leading={<Plus size={13} />}
                    onClick={() => openModal({ kind: "create_tag", group })}
                  >
                    添加具体分类
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      openModal({
                        kind: "rename",
                        level: 1,
                        id: group.id,
                        name: group.name,
                        description: group.description,
                      })
                    }
                    title="重命名大类"
                  >
                    <PenLine size={14} />
                  </Button>
                  {tree.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openModal({ kind: "merge_group", group })}
                      title="合并到其他大类"
                    >
                      <GitMerge size={14} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setArchiveError("");
                      setArchiving({ level: 1, id: group.id, label: group.name });
                    }}
                    title="归档大类"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </header>

              {group.children.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  此大类下还没有第二层级具体分类。
                </p>
              ) : (
                <div className="grid gap-2">
                  {group.children.map((child) => (
                    <div
                      key={child.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-zzm-fill/60 px-3.5 py-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral" uppercase>
                          L2
                        </Badge>
                        <Link
                          to={`/inspirations?group_id=${group.id}&tag_id=${child.id}`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {child.name}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">
                          {child.count} 条
                        </span>
                        {child.description && (
                          <span className="text-xs text-muted-foreground">
                            · {child.description}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="重命名"
                          onClick={() =>
                            openModal({
                              kind: "rename",
                              level: 2,
                              id: child.id,
                              name: child.name,
                              description: child.description,
                            })
                          }
                        >
                          <PenLine size={13} />
                        </Button>
                        {tree.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="移动到其他概念大类"
                            onClick={() =>
                              openModal({
                                kind: "move",
                                child,
                                currentGroupName: group.name,
                              })
                            }
                          >
                            <ArrowRightLeft size={13} />
                          </Button>
                        )}
                        {allLevel2.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="合并到其他具体分类"
                            onClick={() =>
                              openModal({
                                kind: "merge_tag",
                                child,
                                groupName: group.name,
                              })
                            }
                          >
                            <GitMerge size={13} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="归档分类"
                          onClick={() => {
                            setArchiveError("");
                            setArchiving({
                              level: 2,
                              id: child.id,
                              label: `${group.name}/${child.name}`,
                            });
                          }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        size="sm"
        title={
          modal?.kind === "create_group"
            ? "新建一级概念大类"
            : modal?.kind === "create_tag"
              ? `在「${modal.group.name}」下新建二级分类`
              : modal?.kind === "rename"
                ? `重命名${modal.level === 1 ? "概念大类" : "具体分类"}`
                : modal?.kind === "move"
                  ? `移动「${modal.child.name}」所属大类`
                  : modal?.kind === "merge_group"
                    ? `合并大类「${modal.group.name}」`
                    : modal?.kind === "merge_tag"
                      ? `合并分类「${modal.groupName}/${modal.child.name}」`
                      : ""
        }
        error={modalError}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void submitModal()}>
              确认
            </Button>
          </>
        }
      >
        {(modal?.kind === "create_group" ||
          modal?.kind === "create_tag" ||
          modal?.kind === "rename") && (
          <div className="grid gap-3">
            <TextInput
              label="名称（不含斜杠，≤40字）"
              type="text"
              maxLength={40}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <TextInput
              label="说明（可选）"
              type="text"
              maxLength={200}
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
            />
          </div>
        )}

        {(modal?.kind === "move" || modal?.kind === "merge_group") && (
          <label className="block">
            <span className="field-label">
              {modal.kind === "move" ? "目标概念大类" : "合并到目标概念大类"}
            </span>
            <span className="field">
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {(tree ?? [])
                  .filter((g) =>
                    modal.kind === "move"
                      ? g.id !== modal.child.parent_id
                      : g.id !== modal.group.id,
                  )
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </span>
          </label>
        )}

        {modal?.kind === "merge_tag" && (
          <label className="block">
            <span className="field-label">
              合并到目标二级分类（原关联灵感自动迁移）
            </span>
            <span className="field">
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {allLevel2
                  .filter((c) => c.id !== modal.child.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.groupName} / {c.name}
                    </option>
                  ))}
              </select>
            </span>
          </label>
        )}
      </Modal>

      <AlertDialog
        open={Boolean(archiving)}
        title={`归档「${archiving?.label ?? ""}」？`}
        description={
          archiving?.level === 1
            ? "归档概念大类会一并归档其下二级分类，并解除与灵感的标签关联（不会删除灵感正文）。"
            : "归档后将解除该分类与灵感的关联，不会删除灵感正文。"
        }
        tone="destructive"
        confirmLabel="确认归档"
        busy={archiveBusy}
        error={archiveError}
        onCancel={() => setArchiving(null)}
        onConfirm={() => void confirmArchive()}
      />
    </section>
  );
}
