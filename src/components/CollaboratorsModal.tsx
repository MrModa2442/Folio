import React, { useState } from 'react';
import { Booklist, Collaborator } from '../types/library';
import { addCollaborator, removeCollaborator, toggleBooklistPrivacy } from '../utils/library';
import { X, Lock, Globe, Copy, Check, UserPlus, Users, Trash2, Shield, Eye, Edit3 } from 'lucide-react';

interface CollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  booklist: Booklist;
  onUpdateBooklist: (updated: Booklist) => void;
}

export const CollaboratorsModal: React.FC<CollaboratorsModalProps> = ({
  isOpen,
  onClose,
  booklist,
  onUpdateBooklist,
}) => {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    const url = `${window.location.origin}/?shelf=${booklist.id}&invite=${booklist.inviteCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(booklist.inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleAddCollaborator = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const name = inviteEmail.split('@')[0];
    const colors = ['#78350F', '#14532D', '#1E1B4B', '#581C1A', '#312E81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const updated = addCollaborator(booklist, {
      email: inviteEmail.trim(),
      name: name.charAt(0).toUpperCase() + name.slice(1),
      role: inviteRole,
      avatarColor: randomColor,
    });

    onUpdateBooklist(updated);
    setInviteEmail('');
  };

  const handleRemoveCollaborator = (collabId: string) => {
    const updated = removeCollaborator(booklist, collabId);
    onUpdateBooklist(updated);
  };

  const handleTogglePrivacy = (isPublic: boolean) => {
    const updated = toggleBooklistPrivacy(booklist, isPublic);
    onUpdateBooklist(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-[#FAF7F0] w-full max-w-lg rounded-xl shadow-2xl border border-[#E5DECF] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#F2EBDE] border-b border-[#E5DECF] flex items-center justify-between">
          <div>
            <h2 className="font-serif text-xl font-bold text-[#2B1E16] flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-900" />
              <span>Shelf Access &amp; Collaboration</span>
            </h2>
            <p className="text-xs text-[#7A6B5C]">
              Manage who can see and curate &ldquo;{booklist.title}&rdquo;
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#E2D8C7] text-[#6B5E51] transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Privacy Toggle Card */}
          <div className="p-4 bg-[#F5EFE6] rounded-lg border border-[#E5DECF]">
            <span className="text-xs font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold block mb-2">
              Shelf Visibility Mode
            </span>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleTogglePrivacy(false)}
                className={`p-3 rounded-md border text-left transition-all ${
                  !booklist.isPublic
                    ? 'bg-amber-100/70 border-amber-400 text-amber-950 font-medium'
                    : 'bg-white border-[#D5C9B8] text-[#6B5E51] hover:bg-[#FAF7F0]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                  <Lock className="w-3.5 h-3.5 text-amber-900" />
                  <span>Private (Invite Only)</span>
                </div>
                <p className="text-[11px] text-[#7A6B5C]">
                  Only you and readers with invitations can view this shelf.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleTogglePrivacy(true)}
                className={`p-3 rounded-md border text-left transition-all ${
                  booklist.isPublic
                    ? 'bg-emerald-100/70 border-emerald-400 text-emerald-950 font-medium'
                    : 'bg-white border-[#D5C9B8] text-[#6B5E51] hover:bg-[#FAF7F0]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                  <Globe className="w-3.5 h-3.5 text-emerald-800" />
                  <span>Public Community</span>
                </div>
                <p className="text-[11px] text-[#7A6B5C]">
                  Discoverable by everyone in the Explore Shelves feed.
                </p>
              </button>
            </div>
          </div>

          {/* Share Links & Invite Code */}
          <div>
            <span className="text-xs font-semibold text-[#3D2817] block mb-2">
              {booklist.isPublic ? 'Public Share Link' : 'Secret Invite Link & Passcode'}
            </span>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/?shelf=${booklist.id}${!booklist.isPublic ? `&invite=${booklist.inviteCode}` : ''}`}
                  className="flex-1 text-xs px-3 py-2 rounded border border-[#D5C9B8] bg-white font-mono text-[#5C4F42]"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3.5 py-2 text-xs font-medium bg-[#3D2817] text-amber-100 hover:bg-[#25170C] rounded transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Copied Link!' : 'Copy Link'}</span>
                </button>
              </div>

              {!booklist.isPublic && (
                <div className="flex items-center justify-between p-2.5 bg-[#F5EFE6] rounded border border-[#E5DECF] text-xs">
                  <div>
                    <span className="text-[#7A6B5C] mr-2">Secret Invite Code:</span>
                    <span className="font-mono font-bold text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded">
                      {booklist.inviteCode}
                    </span>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="text-xs text-amber-900 hover:underline flex items-center gap-1 font-medium"
                  >
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Invite Reader by Email */}
          <div>
            <span className="text-xs font-semibold text-[#3D2817] block mb-2">
              Invite Reading Partner by Email
            </span>
            <form onSubmit={handleAddCollaborator} className="flex gap-2">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="reader@bookclub.org or IAmMrModa@gmail.com"
                className="flex-1 text-xs px-3 py-2 rounded border border-[#D5C9B8] bg-white focus:outline-hidden"
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'editor' | 'viewer')}
                className="text-xs px-2.5 py-2 rounded border border-[#D5C9B8] bg-white"
              >
                <option value="editor">Can Add Books (Editor)</option>
                <option value="viewer">Can Only Read (Viewer)</option>
              </select>
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold bg-[#3D2817] text-amber-100 hover:bg-[#25170C] rounded transition-colors flex items-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Invite</span>
              </button>
            </form>
          </div>

          {/* Current Collaborators List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono uppercase tracking-wider text-[#7A6B5C] font-semibold">
                Readers with Access ({1 + booklist.collaborators.length})
              </span>
            </div>

            <div className="divide-y divide-[#EAE2D4] border border-[#E5DECF] rounded-lg bg-white overflow-hidden text-xs">
              {/* Shelf Owner */}
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#3D2817] text-amber-200 flex items-center justify-center font-serif text-xs font-bold">
                    {booklist.ownerName.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-[#2B1E16]">
                      {booklist.ownerName} <span className="text-[#8A7968] font-normal">(Creator)</span>
                    </p>
                    <p className="text-[11px] text-[#8A7968]">{booklist.ownerEmail}</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono uppercase bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-semibold">
                  Owner
                </span>
              </div>

              {/* Collaborator rows */}
              {booklist.collaborators.map(c => (
                <div key={c.id} className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-full text-white flex items-center justify-center font-serif text-xs font-bold"
                      style={{ backgroundColor: c.avatarColor }}
                    >
                      {c.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-[#2B1E16]">{c.name}</p>
                      <p className="text-[11px] text-[#8A7968]">{c.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase bg-[#F3EDE2] text-[#5C4F42] px-2 py-0.5 rounded capitalize">
                      {c.role}
                    </span>
                    <button
                      onClick={() => handleRemoveCollaborator(c.id)}
                      className="p-1 rounded hover:bg-rose-100 text-rose-700 transition-colors"
                      title="Revoke access"
                      aria-label={`Revoke access for ${c.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {booklist.collaborators.length === 0 && (
                <div className="p-4 text-center text-[#8A7968] text-xs italic">
                  No other collaborators yet. Invite reading companions above or share the secret link.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#F2EBDE] border-t border-[#E5DECF] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-amber-100 bg-[#3D2817] hover:bg-[#25170C] rounded shadow-sm transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
