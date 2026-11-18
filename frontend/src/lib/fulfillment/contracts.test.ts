import { describe,it,expect } from "vitest";
import { quantity,payloadSchema,receiptSchema } from "./contracts";
describe("exact wire quantities",()=>{
  it.each([["0.001","0.001"],["1","1.000"],["999999999999999.999","999999999999999.999"]])("canonicalizes %s without floating point",(value,result)=>expect(quantity(value)).toBe(result));
  it.each([1,0.1,true,false,null,"-1","NaN","Infinity","1e3","1,000","1.0001","1000000000000000","0","01"," 1 ","1."])("rejects %j before conversion",value=>expect(()=>quantity(value)).toThrow());
  it("allows explicit zero only for physical counts",()=>expect(quantity("0",true)).toBe("0.000"));
  it("preserves leading barcode zeros and omitted allocation",()=>{const p=payloadSchema.parse({operation:"SCAN_PICK",phase:"PICK",epoch:1,barcode:"0000123",quantity:"1.000"});expect(p.barcode).toBe("0000123");expect(Object.hasOwn(p,"allocation_id")).toBe(false);});
  it("requires allocation for undo and refuses secret extensions",()=>{expect(()=>payloadSchema.parse({operation:"UNDO_PICK",phase:"PICK",epoch:1,quantity:"1.000"})).toThrow();expect(()=>payloadSchema.parse({operation:"SCAN_PICK",phase:"PICK",epoch:1,barcode:"1",quantity:"1.000",token:"secret"})).toThrow();});
  it("does not accept a generic HTTP failure as a receipt",()=>expect(()=>receiptSchema.parse({status:409,message:"conflict"})).toThrow());
});
