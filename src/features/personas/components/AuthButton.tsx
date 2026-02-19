import { useState, useRef, useEffect } from "react";
import { Chrome, LogOut, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/stores/authStore";

export default function AuthButton() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOffline = useAuthStore((s) => s.isOffline);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  if (!isAuthenticated) {
    return (
      <button
        onClick={loginWithGoogle}
        disabled={isLoading}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all group
          hover:bg-primary/10 border border-transparent hover:border-primary/20
          disabled:opacity-50"
        title="Sign in with Google"
      >
        <Chrome
          className={`w-5 h-5 transition-colors text-muted-foreground/50 group-hover:text-primary ${
            isLoading ? "animate-pulse" : ""
          }`}
        />
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all group
          hover:bg-secondary/50 relative"
        title={user?.display_name ?? user?.email ?? "Account"}
      >
        {user?.avatar_url ? (
          <img
            src={user.avatar_url}
            alt={user.display_name ?? "User"}
            className="w-7 h-7 rounded-full border border-primary/20"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/20
            flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
        )}
        {isOffline && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full
            bg-amber-500 border-2 border-secondary/40" />
        )}
      </button>

      <AnimatePresence>
        {dropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-full ml-2 mb-0 w-56 rounded-xl
              bg-secondary border border-primary/15 shadow-xl z-50 py-1 overflow-hidden"
          >
            {/* User info */}
            <div className="px-3 py-2.5 border-b border-primary/10">
              <div className="text-sm font-medium text-foreground/90 truncate">
                {user?.display_name ?? user?.email}
              </div>
              {user?.display_name && (
                <div className="text-xs text-muted-foreground/50 truncate mt-0.5">
                  {user.email}
                </div>
              )}
              {isOffline && (
                <span className="inline-block mt-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full
                  bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase">
                  Offline
                </span>
              )}
            </div>

            {/* Sign out */}
            <button
              onClick={() => {
                logout();
                setDropdownOpen(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5
                hover:bg-primary/5 transition-colors text-sm text-foreground/70"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
