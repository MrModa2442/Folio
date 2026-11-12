import React, { useState } from 'react';
import { AppTheme, Booklist } from '../types/library';
import { addCollaborator, removeCollaborator, toggleBooklistPrivacy } from '../utils/library';
import { X, Lock, Globe, Copy, Check, UserPlus, Users, Trash2 } from 'lucide-react';

interface CollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  booklist: Booklist;
  onUpdateBooklist: (updated: Booklist) => void;
  theme?: AppTheme;
}

export const CollaboratorsModal: React.FC<CollaboratorsModalProps> = ({
  isOpen,
  onClose,
  booklist,
  onUpdateBooklist,
  theme = 'spotify-dark',
}) => {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';

  const modalShell = isDark
    ? 'bg-[#181818] text-white border-[#282828]'
    : isWarm
    ? 'bg-[#FAF7F0] text-[#2B1E16] border-[#E5DECF]'
    : 'bg-white text-zinc-900 border-zinc-200';

  const modalHeader = isDark
    ? 'bg-[#1F1F1F] border-[#282828]'
    : isWarm
    ? 'bg-[#F2EBDE] border-[#E5DECF]'
    : 'bg-zinc-50 border-zinc-200';

  const innerCard = isDark
    ? 'bg-[#121212] border-[#282828]'
    : isWarm
    ? 'bg-[#F5EFE6] border-[#E5DECF]'
    : 'bg-zinc-50 border-zinc-200';

  const inputClass = isDark
    ? 'border-[#333333] bg-[#242424] text-white'
    : isWarm
    ? 'border-[#D5C9B8] bg-white text-[#2B1E16]'
    : 'border-zinc-300 bg-white text-zinc-900';

  const mutedText = isDark
    ? 'text-[#B3B3B3]'
    : isWarm
    ? 'text-[#7A6B5C]'
    : 'text-zinc-500';

  const primaryBtn = isDark
    ? 'bg-[#1DB954] text-black hover:bg-[#1ed760]'
    : isWarm
    ? 'bg-[#3D2817] text-amber-100 hover:bg-[#25170C]'
    : 'bg-zinc-900 text-white hover:bg-zinc-800';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className={`w-full max-w-lg rounded-xl shadow-2xl border overflow-hidden flex flex-col max-h-[90vh] transition-colors ${modalShell}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${modalHeader}`}>
          <div>
            <h2 className="font-serif text-xl font-bold flex items-center gap-2">
              <Users className={`w-5 h-5 ${isDark ? 'text-[#1DB954]' : isWarm ? 'text-amber-900' : 'text-zinc-800'}`} />
              <span>Shelf Access &amp; Collaboration</span>
            </h2>
            <p className={`text-xs ${mutedText}`}>
              Manage who can see and curate &ldquo;{booklist.title}&rdquo;
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Privacy Toggle Card */}
          <div className={`p-4 rounded-lg border ${innerCard}`}>
            <span className={`text-xs font-mono uppercase tracking-wider font-semibold block mb-2 ${mutedText}`}>
              Shelf Visibility Mode
            </span>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleTogglePrivacy(false)}
                className={`p-3 rounded-md border text-left transition-all ${
                  !booklist.isPublic
                    ? isDark
                      ? 'bg-[#282828] border-amber-400 text-white font-medium'
                      : 'bg-amber-100/70 border-amber-400 text-amber-950 font-medium'
                    : isDark
                    ? 'bg-[#181818] border-[#333333] text-[#B3B3B3]'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                  <span>Private (Invite Only)</span>
                </div>
                <p className={`text-[11px] ${mutedText}`}>
                  Only you and readers with invitations can view this shelf.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleTogglePrivacy(true)}
                className={`p-3 rounded-md border text-left transition-all ${
                  booklist.isPublic
                    ? isDark
                      ? 'bg-[#282828] border-[#1DB954] text-white font-medium'
                      : 'bg-emerald-100/70 border-emerald-400 text-emerald-950 font-medium'
                    : isDark
                    ? 'bg-[#181818] border-[#333333] text-[#B3B3B3]'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                  <Globe className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Public Community</span>
                </div>
                <p className={`text-[11px] ${mutedText}`}>
                  Discoverable by everyone in the Explore Shelves feed.
                </p>
              </button>
            </div>
          </div>

          {/* Share Links & Invite Code */}
          <div>
            <span className="text-xs font-semibold block mb-2">
              {booklist.isPublic ? 'Public Share Link' : 'Secret Invite Link & Passcode'}
            </span>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/?shelf=${booklist.id}${!booklist.isPublic ? `&invite=${booklist.inviteCode}` : ''}`}
                  className={`flex-1 text-xs px-3 py-2 rounded border font-mono ${inputClass}`}
                />
                <button
                  onClick={handleCopyLink}
                  className={`px-3.5 py-2 text-xs font-medium rounded transition-colors flex items-center gap-1.5 whitespace-nowrap ${primaryBtn}`}
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Copied Link!' : 'Copy Link'}</span>
                </button>
              </div>

              {!booklist.isPublic && (
                <div className={`flex items-center justify-between p-2.5 rounded border text-xs ${innerCard}`}>
                  <div>
                    <span className={`${mutedText} mr-2`}>Secret Invite Code:</span>
                    <span className="font-mono font-bold text-amber-500 bg-amber-500/15 px-2 py-0.5 rounded">
                      {booklist.inviteCode}
                    </span>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="text-xs text-amber-500 hover:underline flex items-center gap-1 font-medium"
                  >
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Invite Reader by Email */}
          <div>
            <span className="text-xs font-semibold block mb-2">
              Invite Reading Partner by Email
            </span>
            <form onSubmit={handleAddCollaborator} className="flex gap-2">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="reader@bookclub.org"
                className={`flex-1 text-xs px-3 py-2 rounded border focus:outline-hidden ${inputClass}`}
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'editor' | 'viewer')}
                className={`text-xs px-2.5 py-2 rounded border ${inputClass}`}
              >
                <option value="editor">Can Add Books (Editor)</option>
                <option value="viewer">Can Only Read (Viewer)</option>
              </select>
              <button
                type="submit"
                className={`px-3.5 py-2 text-xs font-semibold rounded transition-colors flex items-center gap-1 ${primaryBtn}`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Invite</span>
              </button>
            </form>
          </div>

          {/* Current Collaborators List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-mono uppercase tracking-wider font-semibold ${mutedText}`}>
                Readers with Access ({1 + booklist.collaborators.length})
              </span>
            </div>

            <div className={`divide-y border rounded-lg overflow-hidden text-xs ${innerCard} ${isDark ? 'divide-[#242424]' : 'divide-zinc-200'}`}>
              {/* Shelf Owner */}
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-amber-900 text-amber-100 flex items-center justify-center font-serif text-xs font-bold">
                    {booklist.ownerName.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold">
                      {booklist.ownerName} <span className={`${mutedText} font-normal`}>(Creator)</span>
                    </p>
                    <p className={`text-[11px] ${mutedText}`}>{booklist.ownerEmail}</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono uppercase bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded font-semibold">
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
                      <p className="font-semibold">{c.name}</p>
                      <p className={`text-[11px] ${mutedText}`}>{c.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded capitalize ${mutedText}`}>
                      {c.role}
                    </span>
                    <button
                      onClick={() => handleRemoveCollaborator(c.id)}
                      className="p-1 rounded hover:bg-rose-500/15 text-rose-500 transition-colors"
                      title="Revoke access"
                      aria-label={`Revoke access for ${c.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {booklist.collaborators.length === 0 && (
                <div className={`p-4 text-center text-xs italic ${mutedText}`}>
                  No other collaborators yet. Invite reading companions above or share the secret link.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`px-6 py-3 border-t flex justify-end ${modalHeader}`}>
          <button
            onClick={onClose}
            className={`px-5 py-2 text-xs font-semibold rounded shadow-sm transition-colors ${primaryBtn}`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
