"use client";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export function DropdownMenuContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={8} align="end" className="z-50">
        <Menu.Popup
          data-slot="dropdown-menu-content"
          className={cn("account-menu", className)}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
export function DropdownMenuItem(props: Menu.Item.Props) {
  return (
    <Menu.Item
      {...props}
      data-slot="dropdown-menu-item"
      className={cn("account-menu-item", props.className)}
    />
  );
}
