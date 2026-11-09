import React, { useState } from 'react';
import { Booklist } from '../types/library';
import { createBooklist } from '../utils/library';
import { X, Globe, Lock } from 'lucide-react';

interface CreateBooklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateList: (newList: Booklist) => void;
}

export const CreateBooklistModal: React.FC<CreateBooklistModalProps> = ({
  isOpen,
  onClose,
  onCreateList,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  if (!isOpen) return null;

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
      <div className="bg-[#181818] text-white w-full max-w-md rounded-xl shadow-2xl border border-[#282828] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#1F1F1F] border-b border-[#282828] flex items-center justify-between">
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
                className="w-full text-xs px-3 py-2 rounded bg-[#242424] border border-[#333333] focus:outline-hidden focus:border-white"
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
                className="w-full text-xs px-3 py-1.5 rounded bg-[#242424] border border-[#333333] focus:outline-hidden"
              />
            </div>
          </div>

          {/* Privacy Switch */}
          <div className="p-3 bg-[#242424] rounded-lg border border-[#333333]">
            <label className="block text-[11px] font-semibold opacity-80 mb-2">
              Privacy
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`p-2.5 rounded border text-left transition-all ${
                  !isPublic
                    ? 'bg-[#333333] border-white text-white font-medium'
                    : 'bg-[#181818] border-[#333333] text-zinc-400 hover:text-white'
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
                    ? 'bg-[#333333] border-white text-white font-medium'
                    : 'bg-[#181818] border-[#333333] text-zinc-400 hover:text-white'
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
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#282828]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-black bg-[#1DB954] hover:bg-[#1ed760] rounded-full transition-colors shadow-xs"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
