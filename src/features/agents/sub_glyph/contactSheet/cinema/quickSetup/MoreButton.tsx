/** MoreButton - the quiet "more options" path out of an inline quick setup
 *  into the dimension's full picker modal. */
import { ChevronRight } from "lucide-react";
import Button from "@/features/shared/components/buttons/Button";

export function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="self-start" onClick={onClick} iconRight={<ChevronRight className="w-3.5 h-3.5" />}>
      {label}
    </Button>
  );
}
