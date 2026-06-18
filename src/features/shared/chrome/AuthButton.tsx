import { useState, useRef, useEffect } from "react";
import { Globe, LogOut, User } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export default function AuthButton() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOffline = useAuthStore((s) => s.isOffline);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);

  const { t } = useTranslation();
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
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={loginWithGoogle}
        disabled={isLoading}
        icon={
          <Globe
            className={`w-5 h-5 transition-colors text-foreground group-hover:text-primary ${
              isLoading ? "animate-pulse" : ""
            }`}
          />
        }
        className="group border border-transparent hover:border-primary/20 hover:bg-primary/10"
        title={t.chrome.sign_in_google}
      />
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="relative hover:bg-secondary/50"
        title={user?.display_name ?? user?.email ?? t.sidebar.account}
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
      </Button>

      {dropdownOpen && (
          <div
            className="animate-fade-slide-in absolute bottom-full left-full ml-2 mb-0 w-56 rounded-xl
              bg-secondary border border-primary/15 shadow-elevation-3 z-50 py-1 overflow-hidden"
          >
            {/* User info */}
            <div className="px-3 py-2.5 border-b border-primary/10">
              <div className="typo-heading text-foreground/90 truncate">
                {user?.display_name ?? user?.email}
              </div>
              {user?.display_name && (
                <div className="typo-body text-foreground truncate mt-0.5">
                  {user.email}
                </div>
              )}
              {isOffline && (
                <span className="inline-block mt-1.5 px-1.5 py-0.5 typo-label rounded-full
                  bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  {t.chrome.offline}
                </span>
              )}
            </div>

            {/* Sign out */}
            <Button
              variant="ghost"
              size="md"
              block
              icon={<LogOut className="w-4 h-4" />}
              onClick={() => {
                logout();
                setDropdownOpen(false);
              }}
              className="justify-start text-foreground/90 rounded-none"
            >
              {t.chrome.sign_out}
            </Button>
          </div>
        )}
    </div>
  );
}
