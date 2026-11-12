import React, { useState } from 'react';
import { AppTheme, Booklist } from '../types/library';
import { createBooklist } from '../utils/library';
import { X, Globe, Lock } from 'lucide-react';

interface CreateBooklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateList: (newList: Booklist) => void;
  theme?: AppTheme;
}

export const CreateBooklistModal: React.FC<CreateBooklistModalProps> = ({
  isOpen,
  onClose,
  onCreateList,
  theme = 'spotify-dark',
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  if (!isOpen) return null;

  const isDark = theme === 'spotify-dark';
  const isWarm = theme === 'warm-minimal';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const newList = createBooklist({
      title: title.trim(),
      description: description.trim(),
      isPublic,
    });

    onCreateList(newList);
    setTitle('');
    setDescription('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div
        className={`w-full max-w-md rounded-xl shadow-2xl border overflow-hidden flex flex-col transition-colors ${
          isDark
            ? 'bg-[#181818] text-white border-[#282828]'
            : isWarm
            ? 'bg-[#FAF6EE] text-[#292524] border-[#E2D9C5]'
            : 'bg-white text-zinc-900 border-zinc-200'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-3.5 border-b flex items-center justify-between ${
            isDark
              ? 'bg-[#1F1F1F] border-[#282828]'
              : isWarm
              ? 'bg-[#F2EBDD] border-[#E2D9C5]'
              : 'bg-zinc-50 border-zinc-200'
          }`}
        >
          <h2 className="text-sm font-bold tracking-tight">
            New Playlist
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold opacity-80 mb-1">
                Playlist Name *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Weekend Reads"
                className={`w-full text-xs px-3 py-2 rounded border focus:outline-hidden ${
                  isDark
                    ? 'bg-[#242424] border-[#333333] text-white focus:border-white'
                    : isWarm
                    ? 'bg-white border-[#D5C9B8] text-[#292524] focus:border-[#3D2817]'
                    : 'bg-white border-zinc-300 text-zinc-900 focus:border-zinc-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold opacity-80 mb-1">
                Description
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description..."
                className={`w-full text-xs px-3 py-1.5 rounded border focus:outline-hidden ${
                  isDark
                    ? 'bg-[#242424] border-[#333333] text-white'
                    : isWarm
                    ? 'bg-white border-[#D5C9B8] text-[#292524]'
                    : 'bg-white border-zinc-300 text-zinc-900'
                }`}
              />
            </div>
          </div>

          {/* Privacy Switch */}
          <div
            className={`p-3 rounded-lg border ${
              isDark
                ? 'bg-[#242424] border-[#333333]'
                : isWarm
                ? 'bg-[#F3EDE0] border-[#E2D9C5]'
                : 'bg-zinc-50 border-zinc-200'
            }`}
          >
            <label className="block text-[11px] font-semibold opacity-80 mb-2">
              Privacy
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`p-2.5 rounded border text-left transition-all ${
                  !isPublic
                    ? isDark
                      ? 'bg-[#333333] border-white text-white font-medium'
                      : isWarm
                      ? 'bg-amber-100/70 border-amber-600 text-amber-950 font-medium'
                      : 'bg-white border-zinc-900 text-zinc-900 font-medium shadow-xs'
                    : isDark
                    ? 'bg-[#181818] border-[#333333] text-zinc-400 hover:text-white'
                    : 'bg-white/60 border-zinc-300 text-zinc-500 hover:text-zinc-900'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-0.5">
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                  <span>Private</span>
                </div>
                <p className="text-[10px] opacity-70">
                  Only you and invited friends.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={`p-2.5 rounded border text-left transition-all ${
                  isPublic
                    ? isDark
                      ? 'bg-[#333333] border-white text-white font-medium'
                      : isWarm
                      ? 'bg-emerald-100/70 border-emerald-600 text-emerald-950 font-medium'
                      : 'bg-white border-zinc-900 text-zinc-900 font-medium shadow-xs'
                    : isDark
                    ? 'bg-[#181818] border-[#333333] text-zinc-400 hover:text-white'
                    : 'bg-white/60 border-zinc-300 text-zinc-500 hover:text-zinc-900'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-0.5">
                  <Globe className="w-3.5 h-3.5 text-[#1DB954]" />
                  <span>Public</span>
                </div>
                <p className="text-[10px] opacity-70">
                  Searchable in Explore.
                </p>
              </button>
            </div>
          </div>

          {/* Footer */}
          <div
            className={`flex items-center justify-end gap-2 pt-2 border-t ${
              isDark ? 'border-[#282828]' : isWarm ? 'border-[#E2D9C5]' : 'border-zinc-200'
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors shadow-xs ${
                isDark
                  ? 'text-black bg-[#1DB954] hover:bg-[#1ed760]'
                  : isWarm
                  ? 'text-amber-100 bg-[#3D2817] hover:bg-[#2B1B0E]'
                  : 'text-white bg-zinc-900 hover:bg-zinc-800'
              }`}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
