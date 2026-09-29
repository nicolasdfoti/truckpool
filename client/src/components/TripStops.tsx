import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTripStops, useReorderTripStops } from "../hooks/useTripStops";
import { useAuth } from "../hooks/useAuth";
import { useParams } from "react-router-dom";

interface SortableItemProps {
  item: StopItem;
  index: number;
}

function SortableItem({ item, index }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.cargoItemId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-[10px] border border-line bg-white p-3 transition-opacity"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-ink-muted hover:text-ink p-1"
        aria-label={`mover ${item.pickupAddress}`}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M4 9h16M4 15h16M4 21h16" />
        </svg>
      </button>
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-canvas-line text-xs font-medium text-ink-soft">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.pickupAddress}</p>
        <p className="text-[12px] text-ink-muted truncate">{item.description}</p>
        <p className="text-[11px] text-ink-muted font-mono">
          código: {item.trackingCode}
        </p>
      </div>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
          item.status === "CONFIRMED"
            ? "bg-success-bg text-success-deep"
            : item.status === "CANCELLED"
              ? "bg-canvas-line text-ink-soft"
              : "bg-brand/10 text-brand"
        }`}
      >
        {item.status === "CONFIRMED"
          ? "confirmada"
          : item.status === "CANCELLED"
            ? "retirada"
            : "pendiente"}
      </span>
    </li>
  );
}

type StopItem = {
  cargoItemId: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  trackingCode: string;
  description: string;
  volume: number;
  status: string;
  stopOrder: number;
};

/**
 * Lista de paradas (pickups) del viaje.
 * - Para cualquier participante: solo lectura.
 * - Para el transportista dueño: reordenable con drag & drop.
 */
export function TripStops() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: stops, isLoading, isError } = useTripStops(id ?? "");
  const reorder = useReorderTripStops(id ?? "");
  const [optimisticStops, setOptimisticStops] = useState<StopItem[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const isCarrierOwner = user?.role === "CARRIER";

  const displayStops = optimisticStops ?? stops ?? [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayStops.findIndex((s) => s.cargoItemId === active.id);
    const newIndex = displayStops.findIndex((s) => s.cargoItemId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(displayStops, oldIndex, newIndex);
    setOptimisticStops(next);

    const items = next.map((stop, idx) => ({
      cargoItemId: stop.cargoItemId,
      order: idx + 1,
    }));
    reorder.mutate(items, {
      onSuccess: () => {
        setOptimisticStops(null);
      },
      onError: () => {
        setOptimisticStops(null);
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label="cargando paradas">
        {[...Array(3)].map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-[10px] border border-line bg-white p-3 animate-pulse"
          >
            <div className="w-6 h-6 rounded-full bg-canvas-line" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-3/4 bg-canvas-line rounded" />
              <div className="h-3 w-1/2 bg-canvas-line rounded" />
            </div>
          </li>
        ))}
      </div>
    );
  }

  if (isError || !stops) {
    return <p className="text-sm text-ink-muted">no pudimos cargar las paradas.</p>;
  }

  if (stops.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        este viaje no tiene paradas de retiro cargadas.
      </p>
    );
  }

  return (
    <section aria-label="paradas del viaje">
      {isCarrierOwner && (
        <p className="mb-2 text-[12px] text-ink-muted">
          arrastrá los ítems para cambiar el orden de las paradas. el cambio se guarda al
          soltar.
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={displayStops.map((s) => s.cargoItemId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2" role="list">
            {displayStops.map((item, index) => (
              <SortableItem key={item.cargoItemId} item={item} index={index} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {reorder.isPending && (
        <p className="mt-2 text-[12px] text-ink-muted">guardando nuevo orden…</p>
      )}
    </section>
  );
}
