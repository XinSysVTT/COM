/**
 * System data models: the replacement for template.json (deprecated in
 * V13/V14, removed in V16). Types are declared in system.json
 * (documentTypes) and these models supply the schema plus the initial
 * values new documents start with — the same defaults the old template
 * carried: HP 10, AP 2, Aim 60, Defense 10, Speed 5; weapon 1d6+1,
 * range 12, equipped.
 */
const { TypeDataModel } = foundry.abstract;
const { StringField, NumberField, BooleanField, SchemaField } = foundry.data.fields;

export class UnitData extends TypeDataModel {
  static defineSchema() {
    return {
      hp: new SchemaField({
        value: new NumberField({ required: true, integer: true, initial: 10 }),
        max: new NumberField({ required: true, integer: true, initial: 10 })
      }),
      ap: new SchemaField({
        value: new NumberField({ required: true, integer: true, initial: 2 }),
        max: new NumberField({ required: true, integer: true, initial: 2 })
      }),
      aim: new NumberField({ required: true, integer: true, initial: 60 }),
      defense: new NumberField({ required: true, integer: true, initial: 10 }),
      speed: new NumberField({ required: true, integer: true, initial: 5 }),
      overwatch: new BooleanField({ initial: false }),
      description: new StringField({ initial: "" })
    };
  }
}

export class WeaponData extends TypeDataModel {
  static defineSchema() {
    return {
      damage: new StringField({ required: true, initial: "1d6+1" }),
      range: new NumberField({ required: true, integer: true, initial: 12 }),
      equipped: new BooleanField({ initial: true }),
      description: new StringField({ initial: "" })
    };
  }
}
