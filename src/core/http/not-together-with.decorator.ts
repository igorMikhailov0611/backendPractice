import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Fails when this property is sent together with any of `others`.
 * class-validator has no built-in "exactly one of" rule; combined with @ValidateIf it gives one.
 */
export function NotTogetherWith(
  others: string[],
  options?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'notTogetherWith',
      target: target.constructor,
      propertyName: propertyName as string,
      constraints: [others],
      options: {
        message: `$property cannot be sent together with ${others.join(', ')}`,
        ...options,
      },
      validator: {
        validate(value: unknown, args) {
          const body = (args?.object ?? {}) as Record<string, unknown>;
          return (
            value === undefined || others.every((k) => body[k] === undefined)
          );
        },
      },
    });
}
